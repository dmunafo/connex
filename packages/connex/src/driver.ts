/* eslint-disable @typescript-eslint/no-unused-vars */
import { DriverNoVendor, SimpleNet } from '@vechain/connex-driver'
import { blake2b256 } from 'thor-devkit'
import { NewSignerFunc } from './signer'

/** the LazyDriver implements vendor methods at construction but allows attaching NoVendorDriver later to be a full one*/
export class LazyDriver implements Connex.Driver {
    private _driver: DriverNoVendor|null = null
    constructor(private readonly signer: Promise<Connex.Signer>) { }
    
    private get noVendor(): DriverNoVendor { 
        if (!this._driver) {
            throw new Error('thor driver is not ready')
        }
        return this._driver
    }
    setNoVendor(driver: DriverNoVendor):void {
        this._driver = driver
    }

    get genesis(): Connex.Thor.Block {
        return this.noVendor.genesis
    }
    get head(): Connex.Thor.Status['head'] {
        return this.noVendor.head
    }
    pollHead(...args: Parameters<Connex.Driver['pollHead']>): ReturnType<Connex.Driver['pollHead']> {
        return this.noVendor.pollHead(...args)
    }
    getBlock(...args: Parameters<Connex.Driver['getBlock']>): ReturnType<Connex.Driver['getBlock']> {
        return this.noVendor.getBlock(...args)
    }
    getTransaction(...args: Parameters<Connex.Driver['getTransaction']>): ReturnType<Connex.Driver['getTransaction']> {
        return this.noVendor.getTransaction(...args)
    }
    getReceipt(...args: Parameters<Connex.Driver['getReceipt']>): ReturnType<Connex.Driver['getReceipt']> {
        return this.noVendor.getReceipt(...args)
    }
    getAccount(...args: Parameters<Connex.Driver['getAccount']>): ReturnType<Connex.Driver['getAccount']> {
        return this.noVendor.getAccount(...args)
    }
    getCode(...args: Parameters<Connex.Driver['getCode']>): ReturnType<Connex.Driver['getCode']> {
        return this.noVendor.getCode(...args)
    }
    getStorage(...args: Parameters<Connex.Driver['getStorage']>): ReturnType<Connex.Driver['getStorage']> {
        return this.noVendor.getStorage(...args)
    }
    explain(...args: Parameters<Connex.Driver['explain']>): ReturnType<Connex.Driver['explain']> {
        return this.noVendor.explain(...args)
    }
    filterEventLogs(...args: Parameters<Connex.Driver['filterEventLogs']>): ReturnType<Connex.Driver['filterEventLogs']> {
        return this.noVendor.filterEventLogs(...args)
    }
    filterTransferLogs(...args: Parameters<Connex.Driver['filterTransferLogs']>): ReturnType<Connex.Driver['filterTransferLogs']> {
        return this.noVendor.filterTransferLogs(...args)
    }

    signTx(...args: Parameters<Connex.Signer['signTx']>): ReturnType<Connex.Signer['signTx']> {
        return this.signer.then(signer => signer.signTx(...args))
    }
    signCert(...args: Parameters<Connex.Signer['signCert']>): ReturnType<Connex.Signer['signCert']> {
        return this.signer.then(signer => signer.signCert(...args))
    }
}

const cache: Record<string, DriverNoVendor> = {}

/**
 * create a no vendor driver
 * @param node the url of thor node
 * @param genesis the enforced genesis block
 */
export function createNoVendor(node: string, genesis: Connex.Thor.Block): DriverNoVendor {
    const key = blake2b256(JSON.stringify({
        node,
        genesis
    })).toString('hex')

    let driver = cache[key]
    if (!driver) {
        cache[key] = driver = new DriverNoVendor(new SimpleNet(node), genesis)
    }
    return driver
}

/**
 * create a full driver
 * @param node the url of thor node
 * @param genesis the enforced genesis block
 * @param newSigner a function to create signer
 */
export function createFull(node: string, genesis: Connex.Thor.Block, newSigner: NewSignerFunc): Connex.Driver {
    const driver = new LazyDriver(newSigner(genesis.id))
    driver.setNoVendor(createNoVendor(node, genesis))

    return driver
}
