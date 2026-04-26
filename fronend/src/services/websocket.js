// src/services/websocket.js  (Driver App)
// STOMP over SockJS.
// Driver subscribes to TWO topics:
//   1. /topic/driver/{driverId}  — incoming ride request notifications
//   2. /topic/ride/{rideId}      — status updates for active rides

import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { WS_BASE } from '../utils/config';

if (typeof global.TextEncoder === 'undefined') {
  try {
    const te = require('text-encoding');
    global.TextEncoder = te.TextEncoder;
    global.TextDecoder = te.TextDecoder;
  } catch (_) {}
}

let stompClient = null;
const activeSubs = {};

export function wsConnect(jwtToken, onConnected) {
  if (stompClient?.active) return;

  stompClient = new Client({
    webSocketFactory: () => new SockJS(WS_BASE),
    connectHeaders: { Authorization: `Bearer ${jwtToken}` },
    reconnectDelay: 5000,
    debug: (msg) => __DEV__ && console.log('[WS]', msg),
    onConnect: () => {
      console.log('[WS] ✅ Connected');
      onConnected?.();
    },
    onStompError: (frame) => console.error('[WS] STOMP Error:', frame.headers?.message),
    onDisconnect: () => console.log('[WS] Disconnected'),
    onWebSocketError: (e) => console.error('[WS] Error:', e),
  });

  stompClient.activate();
}

export function wsDisconnect() {
  Object.keys(activeSubs).forEach(k => {
    try { activeSubs[k]?.unsubscribe(); } catch (_) {}
    delete activeSubs[k];
  });
  stompClient?.deactivate();
  stompClient = null;
}

/**
 * Subscribe to the driver's personal notification topic.
 * The backend sends RideRequestNotification here when a rider books.
 * Topic: /topic/driver/{driverId}
 */
export function wsSubscribeDriverNotifications(driverId, onMessage) {
  if (!stompClient?.connected) {
    console.warn('[WS] Cannot subscribe — not connected');
    return;
  }
  const topic = `/topic/driver/${driverId}`;
  if (activeSubs[topic]) return;

  activeSubs[topic] = stompClient.subscribe(topic, (frame) => {
    try { onMessage(JSON.parse(frame.body)); }
    catch (e) { console.error('[WS] Parse error:', e); }
  });
  console.log('[WS] Subscribed → driver notifications', topic);
}

/** Subscribe to a specific ride's updates (status changes, location) */
export function wsSubscribeRide(rideId, onMessage) {
  if (!stompClient?.connected) return;
  const topic = `/topic/ride/${rideId}`;
  if (activeSubs[topic]) return;

  activeSubs[topic] = stompClient.subscribe(topic, (frame) => {
    try { onMessage(JSON.parse(frame.body)); }
    catch (e) { console.error('[WS] Parse error:', e); }
  });
  console.log('[WS] Subscribed → ride', topic);
}

export function wsUnsubscribeRide(rideId) {
  const topic = `/topic/ride/${rideId}`;
  try { activeSubs[topic]?.unsubscribe(); } catch (_) {}
  delete activeSubs[topic];
}

export function wsUnsubscribeDriverNotifications(driverId) {
  const topic = `/topic/driver/${driverId}`;
  try { activeSubs[topic]?.unsubscribe(); } catch (_) {}
  delete activeSubs[topic];
}

/** Driver sends GPS coordinates during an active ride */
export function wsSendLocation(rideId, driverId, latitude, longitude) {
  if (!stompClient?.connected) return;
  stompClient.publish({
    destination: '/app/location.update',
    body: JSON.stringify({
      rideId, driverId, latitude, longitude,
      timestamp: new Date().toISOString(),
    }),
  });
}

export const wsIsConnected = () => stompClient?.connected === true;
