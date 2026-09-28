import * as assert from 'assert'
import { toHead } from '../src/common'

const block = {
    id: '0x' + 'ab'.repeat(32),
    number: 12,
    timestamp: 1530316800,
    parentID: '0x' + 'cd'.repeat(32),
    txsFeatures: 1,
    gasLimit: 10000000,
    size: 170,
    beneficiary: '0x' + '00'.repeat(20)
}

const head = toHead(block)

assert.deepStrictEqual(head, {
    id: block.id,
    number: block.number,
    timestamp: block.timestamp,
    parentID: block.parentID,
    txsFeatures: block.txsFeatures,
    gasLimit: block.gasLimit
})

const beat = toHead({
    id: block.id,
    number: block.number,
    timestamp: block.timestamp,
    parentID: block.parentID,
    gasLimit: block.gasLimit
})
assert.strictEqual(beat.txsFeatures, undefined)
assert.strictEqual(Object.prototype.hasOwnProperty.call(beat, 'bloom'), false)
