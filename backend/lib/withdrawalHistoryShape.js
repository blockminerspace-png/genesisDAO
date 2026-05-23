export function mapWithdrawalRequestRow(r) {
    const amountCrypto = Number(r.amount_crypto);
    const feeAmount = Number(r.fee_amount || 0);
    const netRaw = Number(r.net_amount);
    return {
        id: String(r.id),
        userId: Number(r.user_id),
        username: String(r.username ?? ''),
        email: String(r.email ?? ''),
        coinId: String(r.coin_id),
        coinSymbol: String(r.coin_symbol ?? ''),
        amountCrypto,
        amountUsdc: Number(r.amount_usdc),
        feeAmount,
        netAmount: netRaw > 0 ? netRaw : amountCrypto - feeAmount,
        walletAddress: String(r.wallet_address ?? ''),
        status: String(r.status ?? ''),
        txHash: r.tx_hash != null && String(r.tx_hash).trim() ? String(r.tx_hash).trim() : null,
        createdAt: Number(r.created_at),
        processedAt: r.processed_at != null ? Number(r.processed_at) : null
    };
}
