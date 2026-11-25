const key = (userId: string, name: string) => `sky-heart.client.navigation.v1:${userId}:${name}`;

export function readClientContext(userId: string, name: string) {
  try { return sessionStorage.getItem(key(userId, name)); } catch { return null; }
}

export function rememberClientContext(userId: string, name: string, value: string) {
  try { sessionStorage.setItem(key(userId, name), value); } catch { /* Optional UI context. */ }
}
