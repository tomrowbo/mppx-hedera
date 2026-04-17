# Splits Implementation for Charge Intent

Apply these changes **after** the other agent's modifications are complete.

---

## 1. `src/client/methods.ts` -- Schema change

### Add `splits` to the request schema input object (line 37, after `externalId`):

**FIND this block (lines 31-48):**
```ts
    request: z.pipe(
      z.object({
        amount: z.amount(),
        currency: z.string(),
        decimals: z.number(),
        recipient: z.string(),
        chainId: z.optional(z.number()),
        description: z.optional(z.string()),
        externalId: z.optional(z.string()),
      }),
      z.transform(({ amount, decimals, chainId, externalId, ...rest }) => ({
        ...rest,
        amount: parseUnits(amount, decimals).toString(),
        ...(chainId !== undefined
          ? { methodDetails: { chainId } }
          : {}),
      })),
    ),
```

**REPLACE WITH:**
```ts
    request: z.pipe(
      z.object({
        amount: z.amount(),
        currency: z.string(),
        decimals: z.number(),
        recipient: z.string(),
        chainId: z.optional(z.number()),
        description: z.optional(z.string()),
        externalId: z.optional(z.string()),
        splits: z.optional(z.array(z.object({
          recipient: z.string(),
          amount: z.amount(),
          memo: z.optional(z.string()),
        })).min(1).max(10)),
      }),
      z.transform(({ amount, decimals, chainId, externalId, splits, ...rest }) => ({
        ...rest,
        amount: parseUnits(amount, decimals).toString(),
        ...(chainId !== undefined
          ? { methodDetails: { chainId } }
          : {}),
        ...(splits !== undefined && {
          splits: splits.map(s => ({
            ...s,
            amount: parseUnits(s.amount, decimals).toString(),
          })),
        }),
      })),
    ),
```

**What changed:**
- Added `splits` field to the input object schema (optional array of 1-10 split objects)
- Added `splits` to the destructured transform parameters
- Added conditional spread that converts each split's `amount` using `parseUnits`

---

## 2. `src/client/charge.ts` -- TransferTransaction with splits

### Replace the simple two-transfer transaction with split-aware logic (lines 72-101):

**FIND this block (lines 72-101):**
```ts
      const amount = Number(BigInt(req.amount));
      const recipient = req.recipient as string; // expects "0.0.XXXX" format

      // Build Attribution memo (same layout as Tempo)
      const serverId = (challenge as any).realm ?? 'hedera-mpp';
      const memo = Attribution.encode({
        challengeId: challenge.id as string,
        clientId,
        serverId,
      });

      // Create Hedera client
      const client = network === 'mainnet'
        ? HederaClient.forMainnet()
        : HederaClient.forTestnet();
      client.setOperator(AccountId.fromString(operatorId), key);

      // Build and execute native TransferTransaction with memo
      const tx = new TransferTransaction()
        .addTokenTransfer(
          TokenId.fromString(tokenId),
          AccountId.fromString(operatorId),
          -amount,
        )
        .addTokenTransfer(
          TokenId.fromString(tokenId),
          AccountId.fromString(recipient),
          amount,
        )
        .setTransactionMemo(memo)
        .freezeWith(client);
```

**REPLACE WITH:**
```ts
      const amount = Number(BigInt(req.amount));
      const recipient = req.recipient as string; // expects "0.0.XXXX" format
      const splits = req.splits as Array<{recipient: string; amount: string; memo?: string}> | undefined;

      // Calculate primary recipient amount (total minus splits)
      let primaryAmount = amount;
      if (splits?.length) {
        const splitTotal = splits.reduce((sum, s) => sum + Number(BigInt(s.amount)), 0);
        primaryAmount = amount - splitTotal;
        if (primaryAmount <= 0) {
          throw new Error('Split amounts exceed or equal the total charge amount');
        }
      }

      // Build Attribution memo (same layout as Tempo)
      const serverId = (challenge as any).realm ?? 'hedera-mpp';
      const memo = Attribution.encode({
        challengeId: challenge.id as string,
        clientId,
        serverId,
      });

      // Create Hedera client
      const client = network === 'mainnet'
        ? HederaClient.forMainnet()
        : HederaClient.forTestnet();
      client.setOperator(AccountId.fromString(operatorId), key);

      // Build native TransferTransaction — debits and credits must sum to zero
      const tx = new TransferTransaction();
      const token = TokenId.fromString(tokenId);

      // Debit payer for full amount
      tx.addTokenTransfer(token, AccountId.fromString(operatorId), -amount);
      // Credit primary recipient
      tx.addTokenTransfer(token, AccountId.fromString(recipient), primaryAmount);
      // Credit each split recipient
      if (splits?.length) {
        for (const split of splits) {
          tx.addTokenTransfer(token, AccountId.fromString(split.recipient), Number(BigInt(split.amount)));
        }
      }

      tx.setTransactionMemo(memo).freezeWith(client);
```

**What changed:**
- Extract `splits` from the request
- Calculate `primaryAmount` as `amount - sum(splits)`
- Guard against splits exceeding the total
- Build the TransferTransaction with one debit (full amount from payer) and multiple credits (primary recipient + each split recipient) -- Hedera enforces that debits and credits sum to zero

---

## 3. `src/server/charge.ts` -- Verify all transfers including splits

### Replace the single-transfer verification with split-aware verification (lines 102-119):

**FIND this block (lines 102-119):**
```ts
      // ── 4. Verify token transfer (amount + recipient + token) ────
      const tokenTransfers: {
        token_id: string;
        account: string;
        amount: number;
      }[] = tx.token_transfers ?? [];

      const matchingCredit = tokenTransfers.find(
        (t) =>
          t.token_id === tokenId &&
          t.account === recipient &&
          BigInt(t.amount) >= BigInt(amount),
      );

      if (!matchingCredit) {
        throw new Errors.VerificationFailedError({
          reason: `No matching token transfer: expected ${amount} of ${tokenId} to ${recipient}`,
        });
      }
```

**REPLACE WITH:**
```ts
      // ── 4. Verify token transfers (amount + recipient + token) ───
      const tokenTransfers: {
        token_id: string;
        account: string;
        amount: number;
      }[] = tx.token_transfers ?? [];

      const splits = (credential.challenge.request as any).splits as
        Array<{recipient: string; amount: string; memo?: string}> | undefined;

      // Calculate expected primary recipient amount
      const primaryAmount = splits?.length
        ? BigInt(amount) - splits.reduce((sum, s) => sum + BigInt(s.amount), 0n)
        : BigInt(amount);

      // Verify primary recipient credit
      const primaryCredit = tokenTransfers.find(
        (t) =>
          t.token_id === tokenId &&
          t.account === recipient &&
          BigInt(t.amount) >= primaryAmount,
      );

      if (!primaryCredit) {
        throw new Errors.VerificationFailedError({
          reason: `No matching token transfer: expected ${primaryAmount} of ${tokenId} to ${recipient}`,
        });
      }

      // Verify each split recipient credit
      if (splits?.length) {
        for (const split of splits) {
          const splitCredit = tokenTransfers.find(
            (t) =>
              t.token_id === tokenId &&
              t.account === split.recipient &&
              BigInt(t.amount) >= BigInt(split.amount),
          );

          if (!splitCredit) {
            throw new Errors.VerificationFailedError({
              reason: `No matching split transfer: expected ${split.amount} of ${tokenId} to ${split.recipient}`,
            });
          }
        }
      }
```

**What changed:**
- Extract `splits` from the credential's challenge request
- Calculate `primaryAmount` as total minus sum of splits (or full amount if no splits)
- Verify the primary recipient received `primaryAmount`
- Verify each split recipient received their specified amount
- Error messages include the specific missing transfer details

---

## Summary of the splits flow

1. **Merchant creates charge request** with optional `splits` array (each has `recipient`, `amount`, optional `memo`)
2. **Schema transform** converts human-readable split amounts to smallest-unit strings via `parseUnits`
3. **Client builds TransferTransaction** with one debit (payer, full amount) and N+1 credits (primary + splits). Hedera consensus enforces zero-sum.
4. **Server verifies** via Mirror Node that ALL expected credits exist in the transaction's `token_transfers` array
