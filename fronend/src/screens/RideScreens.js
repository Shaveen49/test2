// src/screens/RideScreens.js
// Matches backend:
//   RideRequest:  { petId, pickupAddress, pickupLatitude, pickupLongitude,
//                   dropAddress, dropLatitude, dropLongitude, notes? }
//   RideResponse: { id, userId, userName, petId, petName, driverId, driverName,
//                   vehicleNumber, pickupAddress, pickupLatitude, pickupLongitude,
//                   dropAddress, dropLatitude, dropLongitude, status, requestedAt,
//                   acceptedAt, startedAt, completedAt, estimatedFare, notes }
//   Status enum:  REQUESTED | ACCEPTED | STARTED | COMPLETED | CANCELLED

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, FlatList,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { petAPI, rideAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  wsConnect, wsSubscribeRide, wsUnsubscribeRide, wsIsConnected,
} from '../services/websocket';
import { Field, Btn, Spinner, StatusBadge, Empty } from '../components';
import { C, SP, FS, R, SH } from '../utils/theme';

// ─────────────────────────────────────────────────────────
// BookRideScreen
// ─────────────────────────────────────────────────────────
export function BookRideScreen({ navigation }) {
  const [pets,        setPets]        = useState([]);
  const [selectedPet, setSelectedPet] = useState(null);
  const [userCoord,   setUserCoord]   = useState(null);
  const [f, setF] = useState({
    pickupAddress: '', pickupLatitude: '', pickupLongitude: '',
    dropAddress:   '', dropLatitude:   '', dropLongitude:   '',
    notes: '',
  });
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const up = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        // Load pets
        const { data } = await petAPI.getAll();
        const list = data ?? [];
        setPets(list);
        if (list.length > 0) setSelectedPet(list[0]);

        // Get GPS permission + current location for pickup pre-fill
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const { latitude, longitude } = loc.coords;
          setUserCoord({ latitude, longitude });
          up('pickupLatitude',  String(latitude.toFixed(6)));
          up('pickupLongitude', String(longitude.toFixed(6)));

          // Reverse geocode for a human-readable address
          try {
            const [addr] = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (addr) {
              const parts = [addr.name, addr.street, addr.district, addr.city]
                .filter(Boolean);
              up('pickupAddress', parts.join(', '));
            }
          } catch (_) {}
        }
      } catch (_) {}
      finally { setLoading(false); }
    })();
  }, []);

  const validate = () => {
    if (!selectedPet) {
      Alert.alert('Select a Pet', 'Please select the pet that will be transported.');
      return false;
    }
    const numLat = parseFloat(f.pickupLatitude);
    const numLng = parseFloat(f.pickupLongitude);
    if (!f.pickupAddress || isNaN(numLat) || isNaN(numLng)) {
      Alert.alert('Pickup Required', 'Please fill in the pickup address and coordinates.');
      return false;
    }
    const dLat = parseFloat(f.dropLatitude);
    const dLng = parseFloat(f.dropLongitude);
    if (!f.dropAddress || isNaN(dLat) || isNaN(dLng)) {
      Alert.alert('Drop-off Required', 'Please fill in the drop-off address and coordinates.');
      return false;
    }
    return true;
  };

  const book = async () => {
    if (!validate()) return;
    setBooking(true);
    try {
      // RideRequest DTO – exact field names from backend
      const payload = {
        petId:           selectedPet.id,
        pickupAddress:   f.pickupAddress,
        pickupLatitude:  parseFloat(f.pickupLatitude),
        pickupLongitude: parseFloat(f.pickupLongitude),
        dropAddress:     f.dropAddress,
        dropLatitude:    parseFloat(f.dropLatitude),
        dropLongitude:   parseFloat(f.dropLongitude),
        notes:           f.notes || null,
      };
      const { data: ride } = await rideAPI.request(payload);

      Alert.alert(
        '🚗  Ride Requested!',
        ride.driverName
          ? `Driver ${ride.driverName} has been assigned to your ride.`
          : 'Searching for an available driver nearby…',
        [{ text: 'Track Ride', onPress: () =>
            navigation.replace('TrackRide', { rideId: ride.id }) }]
      );
    } catch (ex) {
      Alert.alert('Booking Failed',
        ex.response?.data?.message ?? 'Failed to request ride. Please try again.');
    } finally { setBooking(false); }
  };

  if (loading) return <Spinner msg="Getting your location…" />;

  if (pets.length === 0) return (
    <View style={s.noPets}>
      <Text style={{ fontSize: 64 }}>🐾</Text>
      <Text style={s.noPetsTitle}>No Pets Found</Text>
      <Text style={s.noPetsSub}>You need to add a pet before booking a ride.</Text>
      <Btn title="Add a Pet" onPress={() => navigation.navigate('AddPet')}
        style={{ marginTop: SP.xl, paddingHorizontal: SP.xl }} />
    </View>
  );

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

      {/* Mini map preview */}
      {userCoord && (
        <MapView provider={PROVIDER_GOOGLE} style={s.miniMap}
          initialRegion={{ ...userCoord, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
          scrollEnabled={false} zoomEnabled={false}>
          <Marker coordinate={userCoord} title="You">
            <View style={s.youMk}><Text style={{ fontSize: 16 }}>📍</Text></View>
          </Marker>
        </MapView>
      )}

      {/* Pet selector */}
      <Text style={s.secLbl}>SELECT PET</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SP.lg }}>
        {pets.map(p => {
          const ico = { Cat:'🐱', Bird:'🐦', Rabbit:'🐰', Fish:'🐟' }[p.species] ?? '🐶';
          return (
            <TouchableOpacity key={p.id}
              style={[s.petChip, selectedPet?.id === p.id && s.petChipOn]}
              onPress={() => setSelectedPet(p)}>
              <Text style={{ fontSize: 22, marginBottom: 4 }}>{ico}</Text>
              <Text style={[s.petChipTxt, selectedPet?.id === p.id && { color: C.primary }]}>
                {p.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Pickup */}
      <View style={[s.locCard, { borderLeftColor: C.primary }]}>
        <View style={[s.locDot, { backgroundColor: C.primary }]} />
        <View style={s.flex1}>
          <Text style={s.secLbl}>PICKUP LOCATION</Text>
          <Field value={f.pickupAddress} onChangeText={v => up('pickupAddress', v)}
            placeholder="Pickup address" />
          <View style={s.coordRow}>
            <Field value={f.pickupLatitude} onChangeText={v => up('pickupLatitude', v)}
              placeholder="Latitude" keyboardType="decimal-pad" style={s.half} />
            <Field value={f.pickupLongitude} onChangeText={v => up('pickupLongitude', v)}
              placeholder="Longitude" keyboardType="decimal-pad" style={s.half} />
          </View>
          {userCoord && (
            <TouchableOpacity onPress={() => {
              up('pickupLatitude',  String(userCoord.latitude.toFixed(6)));
              up('pickupLongitude', String(userCoord.longitude.toFixed(6)));
            }}>
              <Text style={s.gpsLink}>📱 Use my GPS location</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Drop-off */}
      <View style={[s.locCard, { borderLeftColor: C.accent }]}>
        <View style={[s.locDot, { backgroundColor: C.accent }]} />
        <View style={s.flex1}>
          <Text style={s.secLbl}>DROP-OFF LOCATION</Text>
          <Field value={f.dropAddress} onChangeText={v => up('dropAddress', v)}
            placeholder="Drop-off address" />
          <View style={s.coordRow}>
            <Field value={f.dropLatitude} onChangeText={v => up('dropLatitude', v)}
              placeholder="Latitude" keyboardType="decimal-pad" style={s.half} />
            <Field value={f.dropLongitude} onChangeText={v => up('dropLongitude', v)}
              placeholder="Longitude" keyboardType="decimal-pad" style={s.half} />
          </View>
          {/* Quick-fill demo coords – Kandy */}
          <TouchableOpacity onPress={() => {
            up('dropAddress',   'Kandy, Central Province, Sri Lanka');
            up('dropLatitude',  '7.2906');
            up('dropLongitude', '80.6337');
          }}>
            <Text style={s.gpsLink}>📍 Quick-fill: Kandy (demo)</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Field label="Special Notes (optional)" value={f.notes}
        onChangeText={v => up('notes', v)}
        placeholder="e.g. My dog is anxious, please drive slowly"
        multiline numberOfLines={2} />

      <View style={s.infoBanner}>
        <Text style={{ fontSize: 16 }}>ℹ️</Text>
        <Text style={s.infoTxt}>
          The nearest available driver will be auto-assigned. You can track their live location after booking.
        </Text>
      </View>

      <Btn title="🚗  Book Ride" onPress={book} loading={booking}
        style={{ paddingVertical: 16, marginBottom: SP.xxl }} />
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────
// TrackRideScreen
// Subscribes to /topic/ride/{rideId} via WebSocket
// Receives LocationUpdate { rideId, driverId, latitude, longitude }
// and RideResponse { status, … } from the server
// ─────────────────────────────────────────────────────────
export function TrackRideScreen({ route, navigation }) {
  const { rideId } = route.params;
  const { token }  = useAuth();

  const [ride,      setRide]      = useState(null);
  const [driverLoc, setDriverLoc] = useState(null);
  const [wsLive,    setWsLive]    = useState(false);
  const [loading,   setLoading]   = useState(true);
  const mapRef = useRef(null);

  useEffect(() => {
    loadRide();

    // Connect WebSocket and subscribe to this ride's topic
    wsConnect(token, () => {
      setWsLive(true);
      wsSubscribeRide(rideId, handleWsMsg);
    });

    return () => wsUnsubscribeRide(rideId);
  }, []);

  const loadRide = async () => {
    try {
      const { data } = await rideAPI.getById(rideId);
      setRide(data);
    } catch (_) {
      Alert.alert('Error', 'Could not load ride details.');
    } finally { setLoading(false); }
  };

  // Handle incoming WebSocket payload
  // Could be LocationUpdate or full RideResponse (status update)
  const handleWsMsg = useCallback((data) => {
    // Location update: has latitude + longitude fields
    if (data.latitude != null && data.longitude != null) {
      const coord = { latitude: data.latitude, longitude: data.longitude };
      setDriverLoc(coord);
      mapRef.current?.animateToRegion(
        { ...coord, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 700
      );
    }
    // Status update: has a status field (RideResponse)
    if (data.status) {
      setRide(prev => ({ ...prev, ...data }));
    }
  }, []);

  const cancelRide = () =>
    Alert.alert('Cancel Ride?', 'Are you sure you want to cancel this ride?', [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
          try { await rideAPI.cancel(rideId); navigation.goBack(); }
          catch (_) { Alert.alert('Error', 'Cannot cancel – ride may have already started.'); }
      }},
    ]);

  if (loading || !ride) return <Spinner msg="Loading ride…" />;

  const pickupCoord = { latitude: ride.pickupLatitude,  longitude: ride.pickupLongitude };
  const dropCoord   = { latitude: ride.dropLatitude,    longitude: ride.dropLongitude   };

  return (
    <View style={s.screen}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={s.map}
        initialRegion={{ ...pickupCoord, latitudeDelta: 0.07, longitudeDelta: 0.07 }}
      >
        {/* Pickup marker */}
        <Marker coordinate={pickupCoord} title="Pickup Location">
          <View style={s.mkWrap}><Text style={{ fontSize: 20 }}>📍</Text></View>
        </Marker>

        {/* Drop-off marker */}
        <Marker coordinate={dropCoord} title="Drop-off Location">
          <View style={s.mkWrap}><Text style={{ fontSize: 20 }}>🏁</Text></View>
        </Marker>

        {/* Live driver marker */}
        {driverLoc && (
          <Marker coordinate={driverLoc} title="Driver" anchor={{ x: 0.5, y: 0.5 }}>
            <View style={s.driverMk}><Text style={{ fontSize: 22 }}>🚗</Text></View>
          </Marker>
        )}

        {/* Dotted route line */}
        {driverLoc && (
          <Polyline
            coordinates={[driverLoc, pickupCoord, dropCoord]}
            strokeColor={C.primary} strokeWidth={3.5} lineDashPattern={[10, 5]}
          />
        )}
      </MapView>

      {/* Bottom info panel */}
      <View style={s.panel}>
        {/* Status row */}
        <View style={s.panelRow}>
          <StatusBadge status={ride.status} />
          <View style={s.wsRow}>
            <View style={[s.wsDot, { backgroundColor: wsLive ? C.success : C.error }]} />
            <Text style={s.wsTxt}>{wsLive ? 'Live Tracking' : 'Connecting…'}</Text>
          </View>
        </View>

        {/* Driver info */}
        {ride.driverName ? (
          <View style={s.driverRow}>
            <Text style={{ fontSize: 38 }}>🧑‍✈️</Text>
            <View style={{ marginLeft: SP.md }}>
              <Text style={s.driverName}>{ride.driverName}</Text>
              {ride.vehicleNumber
                ? <Text style={s.vehicleNum}>{ride.vehicleNumber}</Text>
                : null}
            </View>
          </View>
        ) : (
          <Text style={s.searchingTxt}>🔍  Searching for a driver nearby…</Text>
        )}

        {/* Route */}
        <View style={s.routeBox}>
          <Text style={s.routeAddr} numberOfLines={1}>📍  {ride.pickupAddress}</Text>
          <Text style={{ color: C.textMuted, marginLeft: SP.md }}>↓</Text>
          <Text style={s.routeAddr} numberOfLines={1}>🏁  {ride.dropAddress}</Text>
        </View>

        {/* Actions */}
        {ride.status === 'REQUESTED' && (
          <Btn title="Cancel Ride" onPress={cancelRide} danger style={{ marginTop: SP.sm }} />
        )}
        {ride.status === 'COMPLETED' && (
          <View style={s.completeBanner}>
            <Text style={s.completeTxt}>✅  Ride completed! Your pet is safe.</Text>
          </View>
        )}
        {ride.status === 'CANCELLED' && (
          <View style={[s.completeBanner, { backgroundColor: C.errorBg }]}>
            <Text style={[s.completeTxt, { color: C.error }]}>❌  Ride was cancelled.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// RideHistoryScreen
// ─────────────────────────────────────────────────────────
export function RideHistoryScreen({ navigation }) {
  const [rides,   setRides]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    rideAPI.getMyRides()
      .then(({ data }) => setRides(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <FlatList
      data={rides}
      keyExtractor={i => i.id.toString()}
      contentContainerStyle={{ padding: SP.md, paddingBottom: 60 }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={s.histCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('TrackRide', { rideId: item.id })}>
          <View style={s.histTop}>
            <StatusBadge status={item.status} />
            <Text style={s.histDate}>
              {new Date(item.requestedAt).toLocaleDateString('en-LK',
                { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>
          <Text style={s.histPet}>🐾  {item.petName}</Text>
          <Text style={s.histAddr} numberOfLines={1}>📍  {item.pickupAddress}</Text>
          <Text style={s.histAddr} numberOfLines={1}>🏁  {item.dropAddress}</Text>
          {item.driverName
            ? <Text style={s.histDriver}>Driver: {item.driverName}</Text>
            : null}
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <Empty icon="🛣️" title="No rides yet"
          sub="Your ride history will appear here after you book a ride." />
      }
    />
  );
}

const s = StyleSheet.create({
  screen:      { flex:1, backgroundColor:C.bg },
  content:     { padding:SP.md, paddingBottom:40 },
  flex1:       { flex:1 },
  // Book ride
  miniMap:     { height:170, borderRadius:R.md, marginBottom:SP.lg, overflow:'hidden' },
  youMk:       { backgroundColor:C.white, borderRadius:16, padding:4, ...SH.sm },
  secLbl:      { fontSize:FS.xs, fontWeight:'700', color:C.textSub,
    textTransform:'uppercase', letterSpacing:0.6, marginBottom:SP.sm },
  petChip:     { alignItems:'center', marginRight:SP.sm, paddingHorizontal:SP.md,
    paddingVertical:SP.sm, borderRadius:R.full, borderWidth:2,
    borderColor:C.border, backgroundColor:C.white },
  petChipOn:   { borderColor:C.primary, backgroundColor:C.primary+'15' },
  petChipTxt:  { fontSize:FS.sm, fontWeight:'700', color:C.textSub },
  locCard:     { flexDirection:'row', backgroundColor:C.white, borderRadius:R.md,
    padding:SP.md, marginBottom:SP.md, borderLeftWidth:4, ...SH.sm },
  locDot:      { width:14, height:14, borderRadius:7, marginTop:5, marginRight:SP.sm },
  coordRow:    { flexDirection:'row', gap:SP.sm },
  half:        { flex:1 },
  gpsLink:     { fontSize:FS.xs, color:C.primary, fontWeight:'700', marginBottom:SP.sm },
  infoBanner:  { flexDirection:'row', backgroundColor:C.infoBg, borderRadius:R.md,
    padding:SP.md, marginBottom:SP.lg, gap:SP.sm, alignItems:'flex-start' },
  infoTxt:     { flex:1, fontSize:FS.sm, color:C.info, lineHeight:20 },
  noPets:      { flex:1, alignItems:'center', justifyContent:'center', padding:SP.xl },
  noPetsTitle: { fontSize:FS.xxl, fontWeight:'900', color:C.text, marginTop:SP.md },
  noPetsSub:   { fontSize:FS.md, color:C.textSub, textAlign:'center', marginTop:SP.xs },
  // Track ride
  map:         { flex:1 },
  mkWrap:      { backgroundColor:C.white, borderRadius:18, padding:5, ...SH.sm },
  driverMk:    { backgroundColor:C.primary, borderRadius:22, padding:8, ...SH.md },
  panel:       { backgroundColor:C.white, padding:SP.lg,
    borderTopLeftRadius:24, borderTopRightRadius:24, ...SH.lg },
  panelRow:    { flexDirection:'row', justifyContent:'space-between',
    alignItems:'center', marginBottom:SP.md },
  wsRow:       { flexDirection:'row', alignItems:'center', gap:6 },
  wsDot:       { width:8, height:8, borderRadius:4 },
  wsTxt:       { fontSize:FS.xs, fontWeight:'700', color:C.textSub },
  driverRow:   { flexDirection:'row', alignItems:'center',
    backgroundColor:C.bg, borderRadius:R.md, padding:SP.md, marginBottom:SP.md },
  driverName:  { fontSize:FS.lg, fontWeight:'800', color:C.text },
  vehicleNum:  { fontSize:FS.sm, color:C.textSub, marginTop:2 },
  searchingTxt:{ fontSize:FS.md, color:C.textSub, marginBottom:SP.md },
  routeBox:    { marginBottom:SP.md },
  routeAddr:   { fontSize:FS.sm, color:C.textSub },
  completeBanner: { backgroundColor:C.successBg, borderRadius:R.md,
    padding:SP.md, alignItems:'center' },
  completeTxt: { fontSize:FS.md, fontWeight:'800', color:C.success },
  // History
  histCard:    { backgroundColor:C.white, borderRadius:R.md, padding:SP.md,
    marginBottom:SP.sm, ...SH.sm },
  histTop:     { flexDirection:'row', justifyContent:'space-between',
    alignItems:'center', marginBottom:SP.sm },
  histDate:    { fontSize:FS.sm, color:C.textSub },
  histPet:     { fontSize:FS.md, fontWeight:'800', color:C.text },
  histAddr:    { fontSize:FS.sm, color:C.textSub, marginTop:3 },
  histDriver:  { fontSize:FS.sm, color:C.primary, fontWeight:'700', marginTop:6 },
});
