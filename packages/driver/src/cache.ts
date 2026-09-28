import * as LRU from 'lru-cache'
import BigNumber from 'bignumber.js'
import { newFilter } from './bloom'

const WINDOW_LEN = 12

type Slot = Connex.Thor.Status['head'] & {
    bloom?: ReturnType<typeof newFilter>
    block?: Connex.Thor.Block

    accounts: Map<string, Account>
    txs: Map<string, Connex.Thor.Transaction>
    receipts: Map<string, Connex.Thor.Transaction.Receipt>
    tied: Map<string, any>
}

export class Cache {
    private readonly irreversible = {
        blocks: new LRU<string | number, Connex.Thor.Block>(256),
        txs: new LRU<string, Connex.Thor.Transaction>(512),
        receipts: new LRU<string, Connex.Thor.Transaction.Receipt>(512)
    }
    private readonly window: Slot[] = []

    public handleNewBlock(
        head: Connex.Thor.Status['head'],
        bloom?: { bits: string, k: number },
        block?: Connex.Thor.Block
    ): void {
        while (this.window.length > 0) {
            const top = this.window[this.window.length - 1]
            if (top.id === head.id) {
                return
            }
            if (top.id === head.parentID) {
                break
            }
            this.window.pop()
        }

        this.window.push({
            ...head,
            bloom: bloom ? newFilter(Buffer.from(bloom.bits.slice(2), 'hex'), bloom.k) : undefined,
            block,
            accounts: new Map<string, Account>(),
            txs: new Map<string, Connex.Thor.Transaction>(),
            receipts: new Map<string, Connex.Thor.Transaction.Receipt>(),
            tied: new Map<string, any>(),
        })

        // shift out old slots and move cached items into frozen cache
        while (this.window.length > WINDOW_LEN) {
            const bottom = this.window.shift()!

            bottom.txs.forEach((v, k) => this.irreversible.txs.set(k, v))
            bottom.receipts.forEach((v, k) => this.irreversible.receipts.set(k, v))
            if (bottom.block) {
                this.irreversible.blocks.set(bottom.block.id, bottom.block)
                this.irreversible.blocks.set(bottom.block.number, bottom.block)
            }
        }
    }

    public async getBlock(
        revision: string | number,
        fetch: () => Promise<Connex.Thor.Block | null>
    ): Promise<Connex.Thor.Block | null> {
        let block = this.irreversible.blocks.get(revision) || null
        if (block) {
            return block
        }

        const { slot } = this.findSlot(revision)

        if (slot && slot.block) {
            return slot.block
        }

        block = await fetch()
        if (block) {
            if (slot && slot.id === block.id) {
                slot.block = block
            }

            if (this.isIrreversible(block.number)) {
                this.irreversible.blocks.set(block.id, block)
                if (block.isTrunk) {
                    this.irreversible.blocks.set(block.number, block)
                }
            }
        }
        return block
    }

    public getTx(
        txid: string,
        fetch: () => Promise<Connex.Thor.Transaction | null>
    ): Promise<Connex.Thor.Transaction | null> {
        return this.readCommitted(
            txid,
            this.irreversible.txs,
            slot => slot.txs,
            fetch,
            tx => tx.meta
        )
    }

    public getReceipt(
        txid: string,
        fetch: () => Promise<Connex.Thor.Transaction.Receipt | null>
    ): Promise<Connex.Thor.Transaction.Receipt | null> {
        return this.readCommitted(
            txid,
            this.irreversible.receipts,
            slot => slot.receipts,
            fetch,
            receipt => receipt.meta
        )
    }

    public async getAccount(
        addr: string,
        revision: string,
        fetch: () => Promise<Connex.Thor.Account>
    ): Promise<Connex.Thor.Account> {
        const found = this.readRevision(
            revision,
            slot => slot.accounts,
            addr,
            slot => !slot.bloom || testBytesHex(slot.bloom, addr)
        )
        if (found.hit && found.slot) {
            return found.hit.snapshot(found.slot.timestamp)
        }
        const accObj = await fetch()
        if (found.slot) {
            found.slot.accounts.set(addr, new Account(accObj, found.slot.timestamp))
        }
        return accObj
    }

    /**
     * get cached entry which is tied to a batch of addresses
     * @param key the cache key
     * @param revision block id where cache bound to
     * @param fetch to fetch value when cache missing
     * @param hints array of tied addresses, as the gist to invalidate cache key. undefined means the key is always
     * invalidated on different revision.
     */
    public async getTied<T>(
        key: string,
        revision: string,
        fetch: () => Promise<T>,
        hints?: string[]
    ): Promise<T> {
        const found = this.readRevision(
            revision,
            slot => slot.tied,
            key,
            // undefined hints invalidate on every new revision; an empty list never does
            slot => !slot.bloom || !hints || hints.some(item => testBytesHex(slot.bloom!, item))
        )
        if (found.hit !== undefined) {
            return found.hit
        }
        const value = await fetch()
        if (found.slot) {
            found.slot.tied.set(key, value)
        }
        return value
    }

    /**
     * Irreversible LRU, then the recent window, then fetch.
     * A value is stored only when metaOf returns the block it belongs to.
     * Pending transactions have no meta and stay uncached.
     */
    private async readCommitted<T>(
        id: string,
        frozen: { get(key: string): T | undefined, set(key: string, value: T): void },
        slotValues: (slot: Slot) => Map<string, T>,
        fetch: () => Promise<T | null>,
        metaOf: (value: T) => { blockID: string, blockNumber: number } | null
    ): Promise<T | null> {
        const frozenHit = frozen.get(id) || null
        if (frozenHit) {
            return frozenHit
        }

        for (const slot of this.window) {
            const hit = slotValues(slot).get(id) || null
            if (hit) {
                return hit
            }
        }

        const value = await fetch()
        const meta = value && metaOf(value)
        if (value && meta) {
            const { slot } = this.findSlot(meta.blockID)
            if (slot) {
                slotValues(slot).set(id, value)
            }
            if (this.isIrreversible(meta.blockNumber)) {
                frozen.set(id, value)
            }
        }
        return value
    }

    /**
     * Walk the window backward from revision. A hit is copied onto the requested
     * slot. dirty() stops the walk: a bloom hit means the key may have changed.
     */
    private readRevision<T>(
        revision: string,
        values: (slot: Slot) => Map<string, T>,
        key: string,
        dirty: (slot: Slot) => boolean
    ): { slot?: Slot, hit?: T } {
        const found = this.findSlot(revision)
        if (found.slot) {
            for (let i = found.index; i >= 0; i--) {
                const slot = this.window[i]
                const hit = values(slot).get(key)
                if (hit) {
                    if (i !== found.index) {
                        values(found.slot).set(key, hit)
                    }
                    return { slot: found.slot, hit }
                }
                if (dirty(slot)) {
                    break
                }
            }
        }
        return { slot: found.slot }
    }

    private findSlot(revision: string | number): { slot?: Slot, index: number } {
        const index = this.window.findIndex(s => s.id === revision || s.number === revision)
        if (index >= 0) {
            return { slot: this.window[index], index }
        }
        return { index }
    }

    private isIrreversible(n: number) {
        if (this.window.length > 0) {
            return n < this.window[this.window.length - 1].number - WINDOW_LEN
        }
        return false
    }
}

function testBytesHex(filter: ReturnType<typeof newFilter>, hex: string) {
    let buf = Buffer.from(hex.slice(2), 'hex')
    const nzIndex = buf.findIndex(v => v !== 0)
    if (nzIndex < 0) {
        buf = Buffer.alloc(0)
    } else {
        buf = buf.slice(nzIndex)
    }
    return filter.contains(buf)
}

const ENERGY_GROWTH_RATE = 5000000000

class Account {
    constructor(readonly obj: Connex.Thor.Account, readonly initTimestamp: number) {
    }

    public snapshot(timestamp: number) {
        return { ...this.obj, energy: this.energyAt(timestamp) }
    }

    private energyAt(timestamp: number) {
        if (timestamp < this.initTimestamp) {
            return this.obj.energy
        }
        return '0x' + new BigNumber(this.obj.balance)
            .times(timestamp - this.initTimestamp)
            .times(ENERGY_GROWTH_RATE)
            .dividedToIntegerBy(1e18)
            .plus(this.obj.energy)
            .toString(16)
    }
}
