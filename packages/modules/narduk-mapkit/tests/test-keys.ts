export async function createTestPrivateKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  const body = Buffer.from(pkcs8).toString('base64').match(/.{1,64}/g)?.join('\n')
  if (!body) throw new Error('Failed to export test private key')
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
}
