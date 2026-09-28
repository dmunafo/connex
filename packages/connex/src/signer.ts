import { loadLibrary } from './script-loader'
import type * as ConnexWalletBuddy from '@vechain/connex-wallet-buddy'
import randomBytes from 'randombytes'
import { blake2b256 } from 'thor-devkit'

const BUDDY_SRC = 'https://unpkg.com/@vechain/connex-wallet-buddy@0.1'
const BUDDY_LIB_NAME = 'ConnexWalletBuddy'

export type NewSignerFunc = (genesisId: string) => Promise<Connex.Signer>

export const createSync2: NewSignerFunc = async (genesisId:string) => {
    return loadLibrary<typeof ConnexWalletBuddy>(
        BUDDY_SRC,
        BUDDY_LIB_NAME
    ).then(lib => lib.create(
        genesisId,
        () => randomBytes(16).toString('hex'),
        val => blake2b256(val).toString('hex')
    ))
}

function applyTxOptions(service: Connex1.Vendor.TxSigningService, options: Connex.Signer.TxOptions): void {
    options.signer && service.signer(options.signer)
    options.gas && service.gas(options.gas)
    options.dependsOn && service.dependsOn(options.dependsOn)
    options.link && service.link(options.link)
    options.comment && service.comment(options.comment)
    if (options.delegator) {
        const url = options.delegator.url
        service.delegate(async (unsignedTx) => {
            const res = await fetch(url, {
                method: 'POST',
                body: JSON.stringify(unsignedTx),
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            return res.json()
        })
    }
    options.onAccepted && options.onAccepted()
}

function applyCertOptions(service: Connex1.Vendor.CertSigningService, options: Connex.Signer.CertOptions): void {
    options.signer && service.signer(options.signer)
    options.link && service.link(options.link)
    options.onAccepted && options.onAccepted()
}

export const createSync: NewSignerFunc = async (genesisId: string) => { 
    const v1 = (window as Required<globalThis.Window>).connex.vendor
    return Promise.resolve({
        signTx: (msg: Connex.Vendor.TxMessage, options: Connex.Signer.TxOptions): Promise<Connex.Vendor.TxResponse> => {
            const s1 = v1.sign('tx')
            applyTxOptions(s1, options)
            return s1.request(msg)
        },
        signCert: (msg: Connex.Vendor.CertMessage, options: Connex.Signer.CertOptions): Promise<Connex.Vendor.CertResponse> => {
            const s1 = v1.sign('cert')
            applyCertOptions(s1, options)
            return s1.request(msg)
        }
    })
}

export declare interface Connex1 {
    readonly vendor: Connex1.Vendor
    readonly thor: Connex1.Thor
}

export declare namespace Connex1 {
    interface Thor {
        readonly genesis: {
            id: string
        }
    }

    namespace Thor {
        type Clause = {
            to: string | null
            value: string | number
            data?: string
        }
    }

    interface Vendor {
        sign<T extends 'tx' | 'cert'>(kind: T): Vendor.SigningService<T>
        owned(addr: string): Promise<boolean>
    }

    namespace Vendor {
        interface TxSigningService {
            signer(addr: string): this
            gas(gas: number): this
            dependsOn(txid: string): this
            link(url: string): this
            comment(text: string): this
            delegate(handler: DelegationHandler): this
            request(msg: TxMessage): Promise<TxResponse>
        }

        interface CertSigningService {
            signer(addr: string): this
            link(url: string): this
            request(msg: CertMessage): Promise<CertResponse>
        }

        type SigningService<T extends 'tx' | 'cert'> =
            T extends 'tx' ? TxSigningService :
            T extends 'cert' ? CertSigningService : never

        type TxMessage = Array<Thor.Clause & {
            comment?: string
            abi?: object
        }>

        type CertMessage = {
            purpose: 'identification' | 'agreement'
            payload: {
                type: 'text'
                content: string
            }
        }

        type TxResponse = {
            txid: string
            signer: string
        }

        type CertResponse = {
            annex: {
                domain: string
                timestamp: number
                signer: string
            }
            signature: string
        }
        type DelegationHandler = (unsignedTx: { raw: string, origin: string }) => Promise<{ signature: string }>
    }
}
