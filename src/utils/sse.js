/**
 * Server-Sent Events (SSE) connection registry.
 *
 * Tracks active SSE response streams keyed by userId and shopId so that
 * the backend can push order-status events to the correct clients
 * without any external message-broker dependency.
 */

/** @type {Map<string, Set<import('express').Response>>} */
const userClients = new Map();

/** @type {Map<string, Set<import('express').Response>>} */
const shopClients = new Map();

/**
 * Register a new SSE client and set up the required HTTP headers.
 * @param {string} key      userId OR shopId
 * @param {Map}    registry The map to register against
 * @param {import('express').Response} res
 */
function addClient(key, registry, res) {
  if (!registry.has(key)) registry.set(key, new Set());
  registry.get(key).add(res);
}

/**
 * Remove a client when the connection closes.
 */
function removeClient(key, registry, res) {
  const set = registry.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) registry.delete(key);
}

/**
 * Write SSE headers and keep the connection alive with a heartbeat.
 * Returns a cleanup function that should be called on 'close'.
 *
 * @param {import('express').Response} res
 * @param {string} key
 * @param {Map} registry
 * @returns {() => void} cleanup
 */
export function initSSEConnection(res, key, registry) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering if behind proxy
  });
  res.flushHeaders();

  // Send an initial "connected" comment so the client knows it's live
  res.write(': connected\n\n');

  addClient(key, registry, res);

  // Keep-alive heartbeat every 25 seconds
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  return () => {
    clearInterval(heartbeat);
    removeClient(key, registry, res);
  };
}

/**
 * Push an SSE event to all connections for a given userId.
 * @param {string} userId
 * @param {string} event  Event name (e.g. 'order:status')
 * @param {object} data
 */
export function sendToUser(userId, event, data) {
  const clients = userClients.get(userId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // Client disconnected — will be cleaned up by 'close' handler
    }
  }
}

/**
 * Push an SSE event to all connections watching a given shopId.
 * @param {string} shopId
 * @param {string} event
 * @param {object} data
 */
export function sendToShop(shopId, event, data) {
  const clients = shopClients.get(shopId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // ignore
    }
  }
}

export { userClients, shopClients };
