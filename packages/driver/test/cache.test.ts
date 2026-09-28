import * as assert from 'assert'
import { Cache } from '../src/cache'

const addr = '0x' + '11'.repeat(20)
const cleanBloom = { bits: '0x00', k: 1 }

function head(number: number, id: string, parentID: string, timestamp: number): Connex.Thor.Status['head'] {
    return {
        id,
        number,
        timestamp,
        parentID,
        gasLimit: 10000000,
        txsFeatures: 0
    }
}

function tx(blockID: string, blockNumber: number): Connex.Thor.Transaction {
    return {
        id: '0x' + 'ab'.repeat(32),
        chainTag: 0,
        blockRef: '0x' + '00'.repeat(8),
        expiration: 18,
        gasPriceCoef: 0,
        gas: 21000,
        origin: addr,
        nonce: '0x1',
        dependsOn: null,
        size: 1,
        clauses: [],
        meta: { blockID, blockNumber, blockTimestamp: 1 }
    }
}

function receipt(blockID: string, blockNumber: number): Connex.Thor.Transaction.Receipt {
    return {
        gasUsed: 1,
        gasPayer: addr,
        paid: '0x0',
        reward: '0x0',
        reverted: false,
        outputs: [],
        meta: {
            blockID,
            blockNumber,
            blockTimestamp: 1,
            txID: '0x' + 'ab'.repeat(32),
            txOrigin: addr
        }
    }
}

const account = {
    balance: '0xde0b6b3a7640000',
    energy: '0x0',
    hasCode: false
}

async function main(): Promise<void> {
    await pendingTxIsNotCached()
    await committedTxIsServedFromTheWindow()
    await oldTxIsServedFromTheIrreversibleCache()
    await recentTxOutsideTheWindowIsFetchedAgain()
    await receiptFollowsTheSameCacheRules()
    await accountOnTheSameSlotSkipsFetch()
    await cleanBloomReusesAnOlderAccountAndGrowsEnergy()
    await missingBloomRefetchesTheAccount()
    await emptyHintsReuseATiedValue()
    await omittedHintsDoNotReuseATiedValue()
}

async function pendingTxIsNotCached(): Promise<void> {
    const cache = new Cache()
    const id = '0x' + '01'.repeat(32)
    cache.handleNewBlock(head(10, id, '0x' + '00'.repeat(32), 1))
    let fetches = 0
    const pending = { ...tx(id, 10), meta: null }
    const load = () => {
        fetches++
        return Promise.resolve(pending)
    }
    assert.strictEqual(await cache.getTx('0xpending', load), pending)
    assert.strictEqual(await cache.getTx('0xpending', load), pending)
    assert.strictEqual(fetches, 2)
}

async function committedTxIsServedFromTheWindow(): Promise<void> {
    const cache = new Cache()
    const id = '0x' + '02'.repeat(32)
    cache.handleNewBlock(head(10, id, '0x' + '00'.repeat(32), 1))
    let fetches = 0
    const committed = tx(id, 10)
    const load = () => {
        fetches++
        return Promise.resolve(committed)
    }
    assert.strictEqual(await cache.getTx('0xtx', load), committed)
    assert.strictEqual(await cache.getTx('0xtx', load), committed)
    assert.strictEqual(fetches, 1)
}

async function oldTxIsServedFromTheIrreversibleCache(): Promise<void> {
    const cache = new Cache()
    cache.handleNewBlock(head(100, '0x' + '03'.repeat(32), '0x' + '00'.repeat(32), 1))
    let fetches = 0
    const committed = tx('0x' + '04'.repeat(32), 87)
    const load = () => {
        fetches++
        return Promise.resolve(committed)
    }
    assert.strictEqual(await cache.getTx('0xold', load), committed)
    assert.strictEqual(await cache.getTx('0xold', load), committed)
    assert.strictEqual(fetches, 1)
}

async function recentTxOutsideTheWindowIsFetchedAgain(): Promise<void> {
    const cache = new Cache()
    cache.handleNewBlock(head(100, '0x' + '05'.repeat(32), '0x' + '00'.repeat(32), 1))
    let fetches = 0
    const committed = tx('0x' + '06'.repeat(32), 95)
    const load = () => {
        fetches++
        return Promise.resolve(committed)
    }
    await cache.getTx('0xmid', load)
    await cache.getTx('0xmid', load)
    assert.strictEqual(fetches, 2)
}

async function receiptFollowsTheSameCacheRules(): Promise<void> {
    const cache = new Cache()
    const id = '0x' + '07'.repeat(32)
    cache.handleNewBlock(head(10, id, '0x' + '00'.repeat(32), 1))
    let fetches = 0
    const body = receipt(id, 10)
    const load = () => {
        fetches++
        return Promise.resolve(body)
    }
    assert.strictEqual(await cache.getReceipt('0xr', load), body)
    assert.strictEqual(await cache.getReceipt('0xr', load), body)
    assert.strictEqual(fetches, 1)

    let missing = 0
    const loadNull = () => {
        missing++
        return Promise.resolve(null)
    }
    assert.strictEqual(await cache.getReceipt('0xnone', loadNull), null)
    assert.strictEqual(await cache.getReceipt('0xnone', loadNull), null)
    assert.strictEqual(missing, 2)
}

async function accountOnTheSameSlotSkipsFetch(): Promise<void> {
    const cache = new Cache()
    const id = '0x' + '08'.repeat(32)
    cache.handleNewBlock(head(1, id, '0x' + '00'.repeat(32), 1000))
    let fetches = 0
    const load = () => {
        fetches++
        return Promise.resolve(account)
    }
    const first = await cache.getAccount(addr, id, load)
    const second = await cache.getAccount(addr, id, load)
    assert.strictEqual(fetches, 1)
    assert.strictEqual(first.energy, '0x0')
    assert.strictEqual(second.energy, '0x0')
}

async function cleanBloomReusesAnOlderAccountAndGrowsEnergy(): Promise<void> {
    const cache = new Cache()
    const parent = '0x' + '09'.repeat(32)
    const child = '0x' + '0a'.repeat(32)
    cache.handleNewBlock(head(1, parent, '0x' + '00'.repeat(32), 1000))
    await cache.getAccount(addr, parent, () => Promise.resolve(account))

    cache.handleNewBlock(head(2, child, parent, 1010), cleanBloom)
    let fetches = 0
    const reused = await cache.getAccount(addr, child, () => {
        fetches++
        return Promise.resolve(account)
    })
    assert.strictEqual(fetches, 0)
    assert.strictEqual(reused.energy, '0xba43b7400')
    assert.strictEqual(reused.balance, account.balance)
}

async function missingBloomRefetchesTheAccount(): Promise<void> {
    const cache = new Cache()
    const parent = '0x' + '0b'.repeat(32)
    const child = '0x' + '0c'.repeat(32)
    cache.handleNewBlock(head(1, parent, '0x' + '00'.repeat(32), 1000))
    await cache.getAccount(addr, parent, () => Promise.resolve(account))
    cache.handleNewBlock(head(2, child, parent, 1010))
    let fetches = 0
    await cache.getAccount(addr, child, () => {
        fetches++
        return Promise.resolve(account)
    })
    assert.strictEqual(fetches, 1)
}

async function emptyHintsReuseATiedValue(): Promise<void> {
    const cache = new Cache()
    const parent = '0x' + '0d'.repeat(32)
    const child = '0x' + '0e'.repeat(32)
    cache.handleNewBlock(head(1, parent, '0x' + '00'.repeat(32), 1))
    await cache.getTied('k', parent, () => Promise.resolve('stored'), [])
    cache.handleNewBlock(head(2, child, parent, 2), cleanBloom)
    let fetches = 0
    const value = await cache.getTied('k', child, () => {
        fetches++
        return Promise.resolve('fresh')
    }, [])
    assert.strictEqual(fetches, 0)
    assert.strictEqual(value, 'stored')
}

async function omittedHintsDoNotReuseATiedValue(): Promise<void> {
    const cache = new Cache()
    const parent = '0x' + '0f'.repeat(32)
    const child = '0x' + '10'.repeat(32)
    cache.handleNewBlock(head(1, parent, '0x' + '00'.repeat(32), 1))
    await cache.getTied('k', parent, () => Promise.resolve('stored'))
    cache.handleNewBlock(head(2, child, parent, 2), cleanBloom)
    let fetches = 0
    const value = await cache.getTied('k', child, () => {
        fetches++
        return Promise.resolve('fresh')
    })
    assert.strictEqual(fetches, 1)
    assert.strictEqual(value, 'fresh')
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
