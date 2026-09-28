import * as assert from 'assert'
import { LazyDriver } from '../src/driver'
import { createSync } from '../src/signer'

const hints = ['0x' + 'ab'.repeat(20)]

function recordingService() {
    const calls: Array<[string, unknown]> = []
    const service = {
        signer(value: string) {
            calls.push(['signer', value])
            return service
        },
        gas(value: number) {
            calls.push(['gas', value])
            return service
        },
        dependsOn(value: string) {
            calls.push(['dependsOn', value])
            return service
        },
        link(value: string) {
            calls.push(['link', value])
            return service
        },
        comment(value: string) {
            calls.push(['comment', value])
            return service
        },
        delegate(handler: unknown) {
            calls.push(['delegate', typeof handler])
            return service
        },
        request(msg: unknown) {
            calls.push(['request', msg])
            return Promise.resolve({ txid: '0x1', signer: '0x2' })
        }
    }
    return { calls, service }
}

async function main(): Promise<void> {
    const seen: Record<string, unknown[][]> = {
        explain: [],
        filterEventLogs: [],
        filterTransferLogs: []
    }
    const fake = {
        explain: (...args: unknown[]) => {
            seen.explain.push(args)
            return Promise.resolve([])
        },
        filterEventLogs: (...args: unknown[]) => {
            seen.filterEventLogs.push(args)
            return Promise.resolve([])
        },
        filterTransferLogs: (...args: unknown[]) => {
            seen.filterTransferLogs.push(args)
            return Promise.resolve([])
        }
    }
    const lazy = new LazyDriver(Promise.resolve({
        signTx: () => Promise.reject(new Error('unused')),
        signCert: () => Promise.reject(new Error('unused'))
    }))
    lazy.setNoVendor(fake as never)

    const explainArg = { clauses: [] }
    const revision = '0x' + '11'.repeat(32)
    await lazy.explain(explainArg, revision, hints)
    await lazy.filterEventLogs({
        range: { unit: 'block', from: 0, to: 1 },
        options: { offset: 0, limit: 1 },
        criteriaSet: [],
        order: 'asc'
    }, hints)
    await lazy.filterTransferLogs({
        range: { unit: 'block', from: 0, to: 1 },
        options: { offset: 0, limit: 1 },
        criteriaSet: [],
        order: 'asc'
    }, hints)

    assert.deepStrictEqual(seen.explain[0], [explainArg, revision, hints])
    assert.deepStrictEqual(seen.filterEventLogs[0][1], hints)
    assert.deepStrictEqual(seen.filterTransferLogs[0][1], hints)

    const tx = recordingService()
    const cert = recordingService()
    ;(global as { window?: unknown }).window = {
        connex: {
            vendor: {
                sign(kind: string) {
                    return kind === 'tx' ? tx.service : cert.service
                }
            }
        }
    }

    const signer = await createSync('0x' + 'cd'.repeat(32))
    let accepted = false
    const link = 'https://example.test/link'
    const comment = 'pay the invoice'
    await signer.signTx([], {
        signer: '0x' + '22'.repeat(20),
        gas: 21000,
        link,
        comment,
        onAccepted: () => { accepted = true }
    })

    assert.deepStrictEqual(tx.calls.map(call => call[0]), ['signer', 'gas', 'link', 'comment', 'request'])
    assert.strictEqual(tx.calls[2][1], link)
    assert.strictEqual(tx.calls[3][1], comment)
    assert.strictEqual(accepted, true)

    await signer.signCert({
        purpose: 'identification',
        payload: { type: 'text', content: 'hi' }
    }, {
        link: 'https://example.test/cert'
    })
    assert.deepStrictEqual(cert.calls.map(call => call[0]), ['link', 'request'])
    assert.strictEqual(cert.calls[0][1], 'https://example.test/cert')
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
