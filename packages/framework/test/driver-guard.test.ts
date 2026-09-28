import * as assert from 'assert'
import { newDriverGuard } from '../src/driver-guard'

const bytes32 = '0x' + '11'.repeat(32)
const address = '0x' + '22'.repeat(20)
const hints = [address]

const genesis: Connex.Thor.Block = {
    id: bytes32,
    number: 0,
    size: 170,
    parentID: bytes32,
    timestamp: 1,
    gasLimit: 10000000,
    beneficiary: address,
    gasUsed: 0,
    totalScore: 0,
    txsRoot: bytes32,
    stateRoot: bytes32,
    receiptsRoot: bytes32,
    signer: address,
    isTrunk: true,
    transactions: []
}

function callsOf(name: string, received: Array<[string, unknown[]]>): unknown[][] {
    return received.filter(entry => entry[0] === name).map(entry => entry[1])
}

async function main(): Promise<void> {
    const received: Array<[string, unknown[]]> = []
    const warnings: string[] = []
    const inner = {
        genesis,
        explain: (...args: unknown[]) => {
            received.push(['explain', args])
            return Promise.resolve([])
        },
        filterEventLogs: (...args: unknown[]) => {
            received.push(['filterEventLogs', args])
            return Promise.resolve([])
        },
        filterTransferLogs: (...args: unknown[]) => {
            received.push(['filterTransferLogs', args])
            return Promise.resolve([])
        },
        getBlock: (...args: unknown[]) => {
            received.push(['getBlock', args])
            return Promise.resolve(null)
        },
        getAccount: (...args: unknown[]) => {
            received.push(['getAccount', args])
            return Promise.resolve({})
        }
    }

    const guarded = newDriverGuard(inner as unknown as Connex.Driver, err => {
        warnings.push(err.message)
    })

    assert.strictEqual(warnings.length, 0, 'valid genesis should pass the guard')

    const revision = '0x' + 'ab'.repeat(32)
    const block = await guarded.getBlock(revision)
    assert.strictEqual(block, null)
    assert.deepStrictEqual(callsOf('getBlock', received), [[revision]])
    assert.strictEqual(warnings.length, 0, 'null block responses are not validated')

    const explainArg = { clauses: [] }
    await guarded.explain(explainArg, revision, hints)
    await guarded.filterEventLogs({
        range: { unit: 'block', from: 0, to: 1 },
        options: { offset: 0, limit: 1 },
        criteriaSet: [],
        order: 'asc'
    }, hints)
    await guarded.filterTransferLogs({
        range: { unit: 'block', from: 0, to: 1 },
        options: { offset: 0, limit: 1 },
        criteriaSet: [],
        order: 'asc'
    }, hints)

    assert.deepStrictEqual(callsOf('explain', received)[0], [explainArg, revision, hints])
    assert.strictEqual(callsOf('filterEventLogs', received)[0].length, 2)
    assert.deepStrictEqual(callsOf('filterEventLogs', received)[0][1], hints)
    assert.deepStrictEqual(callsOf('filterTransferLogs', received)[0][1], hints)

    await guarded.getAccount(address, revision)
    assert.ok(warnings.length > 0, 'malformed account responses are still reported')
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
