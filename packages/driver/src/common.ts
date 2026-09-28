
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/** Fields copied from a block or websocket beat into the tracked head. */
export function toHead(src: {
    id: string
    number: number
    timestamp: number
    parentID: string
    txsFeatures?: number
    gasLimit: number
}): Connex.Thor.Status['head'] {
    return {
        id: src.id,
        number: src.number,
        timestamp: src.timestamp,
        parentID: src.parentID,
        txsFeatures: src.txsFeatures,
        gasLimit: src.gasLimit
    }
}
