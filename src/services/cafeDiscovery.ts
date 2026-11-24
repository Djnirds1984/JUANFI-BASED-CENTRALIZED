/**
 * LAN discovery for the pisonet agent.
 *
 * A freshly installed agent does not know where the panel is, and asking the shop
 * technician to type an address on every desktop is exactly the kind of step that
 * gets skipped and then blamed on the software. So the agent shouts once on the
 * LAN and the panel answers with the URL the agent should talk to.
 *
 * The reply is only an address. Nothing here can register a machine, hand out a
 * token, or unlock anything: an agent still has to be added on the Pisonet page
 * before its heartbeats mean anything.
 */
import dgram from 'dgram';
import { config } from '../config';

export const DISCOVERY_PORT = Math.max(1024, parseInt(process.env.CAFE_DISCOVERY_PORT || '47808', 10) || 47808);
const MAGIC = 'JUANFI-CAFE-HUNT';
const ANSWER = 'JUANFI-CAFE-PANEL';
const AGENT_VERSION = '1.0.0';

let socket: dgram.Socket | null = null;

export function agentVersion(): string {
  return AGENT_VERSION;
}

/**
 * The address a desktop should use. panelPublicUrl is what the portal hands to
 * clients already, but it is often set to a domain or an nginx front-end that a
 * LAN desktop can reach too, so it is the right answer here as well.
 */
export function agentPanelUrl(): string {
  return config.panelPublicUrl;
}

export function startCafeDiscovery(): void {
  stopCafeDiscovery();
  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (msg, rinfo) => {
      const text = String(msg.toString('utf8')).trim();
      if (!text.startsWith(MAGIC)) return;
      const payload = Buffer.from(`${ANSWER} ${agentPanelUrl()} ${AGENT_VERSION}`, 'utf8');
      socket?.send(payload, rinfo.port, rinfo.address, (err) => {
        if (err) console.warn('[pisonet] discovery reply failed:', err.message);
      });
    });
    socket.on('error', (err) => {
      // Port already taken (two panels on one box) is not worth crashing over:
      // the agent still works with a Server= line in its config.ini.
      console.warn('[pisonet] discovery UDP unavailable:', err.message);
      stopCafeDiscovery();
    });
    socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      try {
        socket?.setBroadcast(true);
      } catch { /* some stacks refuse it and unicast replies still work */ }
      console.log(`[pisonet] listening for agent discovery on UDP/${DISCOVERY_PORT}`);
    });
  } catch (err) {
    console.warn('[pisonet] could not open the discovery socket:', (err as Error).message);
    socket = null;
  }
}

export function stopCafeDiscovery(): void {
  if (!socket) return;
  try {
    socket.close();
  } catch { /* already closed */ }
  socket = null;
}
