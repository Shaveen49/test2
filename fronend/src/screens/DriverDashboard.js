// src/screens/DriverDashboard.js
// Fixed behaviour:
//  1. On mount → subscribes to /topic/driver/{driverId} for real-time
//     incoming ride requests (no more polling required)
//  2. Incoming request shows a pop-up with Accept / Ignore buttons
//  3. Driver can CANCEL an accepted ride (sends back to REQUESTED)
//  4. On refresh → also calls GET /rides/driver/nearby so requests
//     received while offline are still visible
//  5. GPS broadcast unchanged (expo-location watchPositionAsync)

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, RefreshControl, Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { rideAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  wsConnect, wsDisconnect,
  wsSubscribeDriverNotifications, wsUnsubscribeDriverNotifications,
  wsSubscribeRide, wsUnsubscribeRide,
  wsSendLocation, wsIsConnected,
} from '../services/websocket';
import { StatusBadge, Spinner, Empty, Btn } from '../components';
import { C, SP, FS, R, SH } from '../utils/theme';

export default function DriverDashboard() {
  const { user, token, logout } = useAuth();

  const [available,    setAvailable]    = useState(false);
  const [myRides,      setMyRides]      = useState([]);   // rides assigned to me
  const [nearbyRides,  setNearbyRides]  = useState([]);   // open REQUESTED rides nearby
  const [activeRide,   setActiveRide]   = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [toggling,     setToggling]     = useState(false);
  const [wsLive,       setWsLive]       = useState(false);

  // Pop-up for an incoming ride request received via WebSocket
  const [incomingRide, setIncomingRide] = useState(null);
  const [accepting,    setAccepting]    = useState(false);

  const locSubscription = useRef(null);
  const driverId = user?.driverId; // set by AuthContext from login response

  // ── WebSocket connect + subscribe on mount ────────────
  useEffect(() => {
    wsConnect(token, () => {
      setWsLive(true);
      // Subscribe to personal driver notification topic
      if (driverId) {
        wsSubscribeDriverNotifications(driverId, handleIncomingRequest);
      }
    });
    return () => {
      wsDisconnect();
      stopGps();
    };
  }, [driverId]);

  useFocusEffect(useCallback(() => { fetchAll(); }, []));

  // ── Fetch rides from backend ───────────────────────────
  const fetchAll = async () => {
    try {
      const [myRes, nearbyRes] = await Promise.all([
        rideAPI.getDriverRides(),
        rideAPI.getNearbyRides().catch(() => ({ data: [] })), // safe fallback
      ]);
      const list   = myRes.data ?? [];
      const nearby = nearbyRes.data ?? [];

      setMyRides(list);

      // Nearby open rides = those NOT already in my list
      const myIds = new Set(list.map(r => r.id));
      setNearbyRides(nearby.filter(r => !myIds.has(r.id)));

      // Active ride = one I've accepted or started
      const active = list.find(r => r.status === 'ACCEPTED' || r.status === 'STARTED');
      setActiveRide(active ?? null);

      if (active?.status === 'STARTED' && !locSubscription.current) {
        startGps(active.id);
      }
    } catch (_) {}
    finally { setLoading(false); setRefreshing(false); }
  };

  // ── Handle real-time ride request from WebSocket ───────
  // Called when the backend pushes a RideRequestNotification
  const handleIncomingRequest = useCallback((data) => {
    if (data.type === 'NEW_RIDE_REQUEST') {
      // Show a pop-up so the driver can decide immediately
      setIncomingRide(data);
    }
  }, []);

  // ── Accept (from pop-up) ───────────────────────────────
  const handleAcceptIncoming = async () => {
    if (!incomingRide) return;
    setAccepting(true);
    try {
      const { data } = await rideAPI.accept(incomingRide.rideId);
      setIncomingRide(null);
      setActiveRide(data);
      fetchAll();
      Alert.alert('Ride Accepted! 🚗', 'Head to the pickup location now.');
    } catch (ex) {
      Alert.alert('Could Not Accept',
        ex.response?.data?.message ?? 'This ride may have been taken by another driver.');
      setIncomingRide(null);
      fetchAll(); // refresh to reflect current state
    } finally { setAccepting(false); }
  };

  // ── Accept (from nearby list card) ────────────────────
  const acceptRide = async (rideId) => {
    try {
      const { data } = await rideAPI.accept(rideId);
      setActiveRide(data);
      fetchAll();
      Alert.alert('Accepted! 🚗', 'Head to the pickup location now.');
    } catch (ex) {
      Alert.alert('Could Not Accept',
        ex.response?.data?.message ?? 'This ride may have already been taken.');
      fetchAll();
    }
  };

  // ── Start ride ─────────────────────────────────────────
  const startRide = async (rideId) => {
    try {
      const { data } = await rideAPI.start(rideId);
      setActiveRide(data);
      fetchAll();
      await startGps(rideId);
      Alert.alert('Ride Started! 🛣️', 'Your live location is now shared with the owner.');
    } catch (ex) {
      Alert.alert('Error', ex.response?.data?.message ?? 'Failed to start ride.');
    }
  };

  // ── Complete ride ──────────────────────────────────────
  const completeRide = (rideId) =>
    Alert.alert('Complete Ride?', 'Confirm you have dropped off the pet safely.', [
      { text: 'Not Yet', style: 'cancel' },
      { text: 'Complete', onPress: async () => {
          try {
            await rideAPI.complete(rideId);
            setActiveRide(null);
            stopGps();
            fetchAll();
            Alert.alert('Completed ✅', 'Great work! You are now available for new rides.');
          } catch (_) { Alert.alert('Error', 'Failed to complete ride.'); }
      }},
    ]);

  // ── Driver cancel an accepted ride ─────────────────────
  const driverCancelRide = (rideId) =>
    Alert.alert(
      'Cancel Ride?',
      'The rider will be informed and the ride will be offered to nearby drivers.',
      [
        { text: 'Keep Ride', style: 'cancel' },
        { text: 'Cancel Ride', style: 'destructive', onPress: async () => {
            try {
              await rideAPI.driverCancel(rideId);
              setActiveRide(null);
              stopGps();
              fetchAll();
              Alert.alert('Ride Cancelled', 'The ride has been returned to the queue.');
            } catch (ex) {
              Alert.alert('Error', ex.response?.data?.message ?? 'Could not cancel ride.');
            }
        }},
      ]
    );

  // ── Availability toggle ────────────────────────────────
  const toggleAvail = async (val) => {
    setToggling(true);
    try {
      await rideAPI.setAvailability(val);
      setAvailable(val);
      if (val) fetchAll(); // refresh nearby rides when going online
    } catch (_) {
      Alert.alert('Error', 'Could not update availability.');
    } finally { setToggling(false); }
  };

  // ── GPS ────────────────────────────────────────────────
  const startGps = async (rideId) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Location access needed to share your position.');
      return;
    }
    locSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 5 },
      (loc) => {
        if (wsIsConnected()) {
          wsSendLocation(rideId, driverId, loc.coords.latitude, loc.coords.longitude);
        }
      }
    );
  };

  const stopGps = () => {
    locSubscription.current?.remove();
    locSubscription.current = null;
  };

  if (loading) return <Spinner msg="Loading dashboard…" />;

  const completedRides = myRides.filter(r =>
    r.status === 'COMPLETED' || r.status === 'CANCELLED'
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={s.screen}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={C.primary}
            onRefresh={() => { setRefreshing(true); fetchAll(); }} />
        }>

        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.headerLabel}>Driver Dashboard</Text>
            <Text style={s.driverName}>{user?.name}</Text>
          </View>
          <TouchableOpacity style={s.logoutBtn} onPress={logout}>
            <Text style={s.logoutTxt}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* ── Status chips ── */}
        <View style={s.statsRow}>
          {[
            { ico: wsLive ? '🟢' : '🔴', lbl: 'WebSocket',
              val: wsLive ? 'Live' : 'Offline' },
            { ico: '🚗', lbl: 'Status',
              val: available ? 'Online' : 'Offline',
              col: available ? C.success : C.textSub },
            { ico: '📦', lbl: 'Active',
              val: activeRide ? '1 Ride' : 'None' },
          ].map(st => (
            <View key={st.lbl} style={s.stat}>
              <Text style={{ fontSize: 20, marginBottom: 4 }}>{st.ico}</Text>
              <Text style={s.statLbl}>{st.lbl}</Text>
              <Text style={[s.statVal, st.col ? { color: st.col } : {}]}>{st.val}</Text>
            </View>
          ))}
        </View>

        {/* ── Availability toggle ── */}
        <View style={s.availCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.availTitle}>
              {available ? '🟢  You are Online' : '⚫  You are Offline'}
            </Text>
            <Text style={s.availSub}>
              {available
                ? 'Ride requests within 5 km will be sent to you'
                : 'Toggle on to start receiving ride requests'}
            </Text>
          </View>
          <Switch
            value={available}
            onValueChange={toggleAvail}
            disabled={toggling}
            trackColor={{ false: C.border, true: C.primaryLight }}
            thumbColor={available ? C.primary : C.white}
            ios_backgroundColor={C.border}
          />
        </View>

        {/* ── Active ride ── */}
        {activeRide && (
          <View style={s.activeCard}>
            <Text style={s.sectionTitle}>🔥  Active Ride</Text>
            <StatusBadge status={activeRide.status} />

            <View style={s.metaRow}>
              <Text style={s.metaLbl}>Pet</Text>
              <Text style={s.metaVal}>🐾  {activeRide.petName}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLbl}>Owner</Text>
              <Text style={s.metaVal}>{activeRide.userName}</Text>
            </View>

            <View style={s.divider} />

            <Text style={s.addrLbl}>PICKUP</Text>
            <Text style={s.addrTxt}>{activeRide.pickupAddress}</Text>
            <Text style={s.addrLbl}>DROP-OFF</Text>
            <Text style={s.addrTxt}>{activeRide.dropAddress}</Text>
            {activeRide.notes ? (
              <Text style={s.notesTxt}>📝  {activeRide.notes}</Text>
            ) : null}

            {/* Action buttons row */}
            <View style={s.actionRow}>
              {/* Start button (only when ACCEPTED) */}
              {activeRide.status === 'ACCEPTED' && (
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: C.info, flex: 1 }]}
                  onPress={() => startRide(activeRide.id)}>
                  <Text style={s.actionBtnTxt}>▶  Start Ride</Text>
                </TouchableOpacity>
              )}

              {/* Complete button (only when STARTED) */}
              {activeRide.status === 'STARTED' && (
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: C.success, flex: 1 }]}
                  onPress={() => completeRide(activeRide.id)}>
                  <Text style={s.actionBtnTxt}>⬛  Complete</Text>
                </TouchableOpacity>
              )}

              {/* Cancel button (only when ACCEPTED — not once started) */}
              {activeRide.status === 'ACCEPTED' && (
                <TouchableOpacity
                  style={[s.actionBtn, s.cancelBtn]}
                  onPress={() => driverCancelRide(activeRide.id)}>
                  <Text style={[s.actionBtnTxt, { color: C.error }]}>✕  Cancel</Text>
                </TouchableOpacity>
              )}
            </View>

            {activeRide.status === 'STARTED' && (
              <View style={s.gpsBanner}>
                <Text style={s.gpsTxt}>📡  Broadcasting live GPS to pet owner…</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Nearby open requests ── */}
        {available && !activeRide && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>
              📬  Nearby Ride Requests
              {nearbyRides.length > 0
                ? <Text style={s.badge}>  {nearbyRides.length}</Text>
                : null}
            </Text>
            {nearbyRides.length === 0 ? (
              <View style={s.emptyNearby}>
                <Text style={s.emptyNearbyTxt}>
                  No open rides within 5 km right now.{'\n'}
                  Pull down to refresh or wait — new requests appear instantly.
                </Text>
              </View>
            ) : (
              nearbyRides.map(r => (
                <View key={r.id} style={s.pendingCard}>
                  <View style={s.pendingHeader}>
                    <Text style={s.pendingPet}>🐾  {r.petName}</Text>
                    <Text style={s.pendingUser}>{r.userName}</Text>
                  </View>
                  <Text style={s.pendingAddr} numberOfLines={1}>📍  {r.pickupAddress}</Text>
                  <Text style={s.pendingAddr} numberOfLines={1}>🏁  {r.dropAddress}</Text>
                  {r.notes ? <Text style={s.notesTxt}>📝  {r.notes}</Text> : null}
                  <TouchableOpacity
                    style={[s.actionBtn, { backgroundColor: C.primary, marginTop: SP.md }]}
                    onPress={() => acceptRide(r.id)}>
                    <Text style={s.actionBtnTxt}>✓  Accept Ride</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        {/* ── Ride history ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Ride History</Text>
          {completedRides.length === 0 ? (
            <Empty icon="🛣️" title="No completed rides yet"
              sub="Accept rides to build your history" />
          ) : (
            completedRides.map(r => (
              <View key={r.id} style={s.histCard}>
                <View style={s.histTop}>
                  <StatusBadge status={r.status} />
                  <Text style={s.histDate}>
                    {new Date(r.requestedAt).toLocaleDateString('en-LK',
                      { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
                <Text style={s.histPet}>🐾  {r.petName}</Text>
                <Text style={s.histAddr} numberOfLines={1}>
                  {r.pickupAddress}  →  {r.dropAddress}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={{ height: SP.xxl }} />
      </ScrollView>

      {/* ═══════════════════════════════════════════════════
          INCOMING RIDE REQUEST POP-UP
          Shown when backend pushes a notification via WebSocket
          ═══════════════════════════════════════════════════ */}
      <Modal
        visible={!!incomingRide}
        transparent
        animationType="slide"
        statusBarTranslucent>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            {/* Pulsing header */}
            <View style={s.modalHeader}>
              <Text style={s.modalHeaderTxt}>🚨  New Ride Request!</Text>
              <Text style={s.modalDist}>Within 5 km of you</Text>
            </View>

            {incomingRide && (
              <>
                <View style={s.modalInfoRow}>
                  <Text style={s.modalIcon}>👤</Text>
                  <View>
                    <Text style={s.modalLabel}>Rider</Text>
                    <Text style={s.modalVal}>{incomingRide.userName}</Text>
                  </View>
                </View>
                <View style={s.modalInfoRow}>
                  <Text style={s.modalIcon}>🐾</Text>
                  <View>
                    <Text style={s.modalLabel}>Pet</Text>
                    <Text style={s.modalVal}>{incomingRide.petName}</Text>
                  </View>
                </View>
                <View style={s.modalDivider} />
                <Text style={s.modalAddrLabel}>PICKUP</Text>
                <Text style={s.modalAddr}>{incomingRide.pickupAddress}</Text>
                <Text style={s.modalAddrLabel}>DROP-OFF</Text>
                <Text style={s.modalAddr}>{incomingRide.dropAddress}</Text>
                {incomingRide.notes ? (
                  <Text style={s.notesTxt}>📝  {incomingRide.notes}</Text>
                ) : null}
              </>
            )}

            <View style={s.modalBtnRow}>
              {/* Ignore — dismiss pop-up, ride stays open for others */}
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnIgnore]}
                onPress={() => setIncomingRide(null)}>
                <Text style={[s.modalBtnTxt, { color: C.textSub }]}>Ignore</Text>
              </TouchableOpacity>

              {/* Accept */}
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnAccept,
                  accepting && { opacity: 0.6 }]}
                onPress={handleAcceptIncoming}
                disabled={accepting}>
                <Text style={[s.modalBtnTxt, { color: C.white }]}>
                  {accepting ? 'Accepting…' : '✓  Accept'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Timer hint */}
            <Text style={s.modalHint}>
              Tap Ignore to dismiss — another driver may accept this ride.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen:        { flex:1, backgroundColor:C.bg },
  content:       { padding:SP.md },
  header:        { flexDirection:'row', justifyContent:'space-between',
    alignItems:'flex-start', marginBottom:SP.xl, marginTop:SP.sm },
  headerLabel:   { fontSize:FS.sm, color:C.textSub, fontWeight:'700' },
  driverName:    { fontSize:FS.xxl, fontWeight:'900', color:C.text },
  logoutBtn:     { paddingHorizontal:SP.md, paddingVertical:SP.sm,
    borderRadius:R.full, borderWidth:1, borderColor:C.border },
  logoutTxt:     { fontSize:FS.sm, color:C.textSub, fontWeight:'700' },
  statsRow:      { flexDirection:'row', gap:SP.sm, marginBottom:SP.md },
  stat:          { flex:1, backgroundColor:C.white, borderRadius:R.md,
    padding:SP.md, alignItems:'center', ...SH.sm },
  statLbl:       { fontSize:FS.xs, color:C.textSub, fontWeight:'700' },
  statVal:       { fontSize:FS.md, fontWeight:'900', color:C.text, marginTop:2 },
  availCard:     { flexDirection:'row', alignItems:'center', backgroundColor:C.white,
    borderRadius:R.md, padding:SP.lg, marginBottom:SP.md, ...SH.sm },
  availTitle:    { fontSize:FS.lg, fontWeight:'800', color:C.text },
  availSub:      { fontSize:FS.sm, color:C.textSub, marginTop:4, lineHeight:20 },
  activeCard:    { backgroundColor:C.white, borderRadius:R.md, padding:SP.lg,
    marginBottom:SP.md, borderLeftWidth:4, borderLeftColor:C.primary, ...SH.md },
  sectionTitle:  { fontSize:FS.lg, fontWeight:'900', color:C.text, marginBottom:SP.md },
  badge:         { fontSize:FS.sm, color:C.white, backgroundColor:C.primary,
    paddingHorizontal:8, paddingVertical:2, borderRadius:R.full },
  metaRow:       { flexDirection:'row', justifyContent:'space-between', marginTop:SP.sm },
  metaLbl:       { fontSize:FS.sm, color:C.textSub, fontWeight:'700' },
  metaVal:       { fontSize:FS.sm, fontWeight:'800', color:C.text },
  divider:       { height:1, backgroundColor:C.border, marginVertical:SP.md },
  addrLbl:       { fontSize:FS.xs, fontWeight:'800', color:C.textSub,
    textTransform:'uppercase', letterSpacing:0.5, marginTop:SP.xs },
  addrTxt:       { fontSize:FS.md, color:C.text, marginBottom:SP.xs },
  notesTxt:      { fontSize:FS.sm, color:C.textSub, fontStyle:'italic', marginTop:SP.xs },
  actionRow:     { flexDirection:'row', gap:SP.sm, marginTop:SP.md },
  actionBtn:     { borderRadius:R.sm, padding:SP.md, alignItems:'center',
    justifyContent:'center' },
  cancelBtn:     { backgroundColor:C.error+'18', borderWidth:1.5, borderColor:C.error,
    paddingHorizontal:SP.lg },
  actionBtnTxt:  { color:C.white, fontWeight:'900', fontSize:FS.md, letterSpacing:0.4 },
  gpsBanner:     { backgroundColor:C.primaryLight+'22', borderRadius:R.sm,
    padding:SP.sm, marginTop:SP.sm, alignItems:'center' },
  gpsTxt:        { fontSize:FS.sm, color:C.primary, fontWeight:'700' },
  section:       { marginBottom:SP.lg },
  emptyNearby:   { backgroundColor:C.white, borderRadius:R.md, padding:SP.lg,
    alignItems:'center', ...SH.sm },
  emptyNearbyTxt:{ fontSize:FS.sm, color:C.textSub, textAlign:'center', lineHeight:22 },
  pendingCard:   { backgroundColor:C.warningBg, borderRadius:R.md, padding:SP.md,
    marginBottom:SP.sm, borderLeftWidth:4, borderLeftColor:C.warning },
  pendingHeader: { flexDirection:'row', justifyContent:'space-between', marginBottom:4 },
  pendingPet:    { fontSize:FS.md, fontWeight:'800', color:C.text },
  pendingUser:   { fontSize:FS.sm, color:C.textSub, fontWeight:'600' },
  pendingAddr:   { fontSize:FS.sm, color:C.textSub, marginTop:4 },
  histCard:      { backgroundColor:C.white, borderRadius:R.md, padding:SP.md,
    marginBottom:SP.sm, ...SH.sm },
  histTop:       { flexDirection:'row', justifyContent:'space-between',
    alignItems:'center', marginBottom:SP.sm },
  histDate:      { fontSize:FS.sm, color:C.textSub },
  histPet:       { fontSize:FS.md, fontWeight:'800', color:C.text },
  histAddr:      { fontSize:FS.sm, color:C.textSub, marginTop:4 },
  // ── Incoming ride pop-up ──────────────────────────────
  modalOverlay:  { flex:1, backgroundColor:C.overlay,
    justifyContent:'flex-end' },
  modalCard:     { backgroundColor:C.white, borderTopLeftRadius:28,
    borderTopRightRadius:28, padding:SP.xl, paddingBottom:SP.xxl },
  modalHeader:   { backgroundColor:C.error, borderRadius:R.md,
    padding:SP.md, marginBottom:SP.lg, alignItems:'center' },
  modalHeaderTxt:{ fontSize:FS.xl, fontWeight:'900', color:C.white },
  modalDist:     { fontSize:FS.sm, color:C.white, opacity:0.9, marginTop:4 },
  modalInfoRow:  { flexDirection:'row', alignItems:'center',
    gap:SP.md, marginBottom:SP.sm },
  modalIcon:     { fontSize:24, width:32 },
  modalLabel:    { fontSize:FS.xs, fontWeight:'700', color:C.textSub,
    textTransform:'uppercase', letterSpacing:0.5 },
  modalVal:      { fontSize:FS.md, fontWeight:'800', color:C.text },
  modalDivider:  { height:1, backgroundColor:C.border, marginVertical:SP.md },
  modalAddrLabel:{ fontSize:FS.xs, fontWeight:'800', color:C.textSub,
    textTransform:'uppercase', letterSpacing:0.5, marginTop:SP.xs },
  modalAddr:     { fontSize:FS.md, color:C.text, marginBottom:SP.xs },
  modalBtnRow:   { flexDirection:'row', gap:SP.md, marginTop:SP.xl },
  modalBtn:      { flex:1, padding:SP.md, borderRadius:R.sm, alignItems:'center' },
  modalBtnIgnore:{ backgroundColor:C.bg, borderWidth:1.5, borderColor:C.border },
  modalBtnAccept:{ backgroundColor:C.primary },
  modalBtnTxt:   { fontSize:FS.lg, fontWeight:'900' },
  modalHint:     { fontSize:FS.xs, color:C.textMuted, textAlign:'center', marginTop:SP.sm },
});
