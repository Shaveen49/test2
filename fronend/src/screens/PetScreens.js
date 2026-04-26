// src/screens/PetScreens.js
// Matches backend PetDto.PetRequest: { name, breed, birthday (YYYY-MM-DD), species?, photoUrl? }

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { petAPI } from '../services/api';
import { PetCard, Empty, Spinner, ErrBox, Field, Btn } from '../components';
import { C, SP, FS, R, SH } from '../utils/theme';

// ── PetListScreen ─────────────────────────────────────────
export function PetListScreen({ navigation }) {
  const [pets,       setPets]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  useFocusEffect(useCallback(() => { fetchPets(); }, []));

  const fetchPets = async () => {
    try {
      setError(null);
      const { data } = await petAPI.getAll();
      setPets(data ?? []);
    } catch (_) {
      setError('Could not load pets. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const confirmDelete = (pet) =>
    Alert.alert(
      `Delete ${pet.name}?`,
      'This will permanently remove the pet and all its records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await petAPI.remove(pet.id);
              fetchPets();
            } catch (_) {
              Alert.alert('Error', 'Could not delete pet. Please try again.');
            }
          },
        },
      ]
    );

  if (loading) return <Spinner msg="Loading your pets…" />;
  if (error)   return <ErrBox msg={error} onRetry={fetchPets} />;

  return (
    <View style={s.screen}>
      <FlatList
        data={pets}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={C.primary}
            onRefresh={() => { setRefreshing(true); fetchPets(); }} />
        }
        renderItem={({ item }) => (
          <View>
            <PetCard
              pet={item}
              onPress={() => navigation.navigate('Medical', {
                petId: item.id, petName: item.name,
              })}
            />
            <TouchableOpacity style={s.delBtn} onPress={() => confirmDelete(item)}>
              <Text style={s.delTxt}>🗑  Remove</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <Empty
            icon="🐾" title="No pets added yet"
            sub="Tap the + button to add your first furry friend!"
            onAction={() => navigation.navigate('AddPet')} actionLbl="Add My First Pet"
          />
        }
      />

      {/* Floating action button */}
      <TouchableOpacity style={s.fab} onPress={() => navigation.navigate('AddPet')} activeOpacity={0.88}>
        <Text style={s.fabTxt}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── AddPetScreen ──────────────────────────────────────────
// birthday must be sent as "YYYY-MM-DD" (LocalDate on backend)
export function AddPetScreen({ navigation }) {
  const SPECIES = ['Dog', 'Cat', 'Bird', 'Rabbit', 'Fish', 'Other'];
  const EMOJI   = { Dog:'🐶', Cat:'🐱', Bird:'🐦', Rabbit:'🐰', Fish:'🐟', Other:'🐾' };

  const [f, setF] = useState({
    name: '', breed: '', birthday: '', species: 'Dog', photoUrl: '',
  });
  const [err,  setErr]  = useState({});
  const [busy, setBusy] = useState(false);
  const up = (k, v) => setF(p => ({ ...p, [k]: v }));

  const validate = () => {
    const e = {};
    if (!f.name.trim())  e.name    = 'Pet name is required';
    if (!f.breed.trim()) e.breed   = 'Breed is required';
    if (!f.birthday)     e.birthday = 'Birthday is required';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birthday))
                         e.birthday = 'Use format YYYY-MM-DD (e.g. 2020-03-15)';
    setErr(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      // Backend PetRequest fields exactly
      await petAPI.create({
        name:     f.name.trim(),
        breed:    f.breed.trim(),
        birthday: f.birthday,           // YYYY-MM-DD  ← LocalDate
        species:  f.species || null,
        photoUrl: f.photoUrl.trim() || null,
      });
      Alert.alert('Added! 🎉', `${f.name} has been added to your pets.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (ex) {
      const msg = ex.response?.data?.message ?? 'Failed to add pet. Please try again.';
      Alert.alert('Error', msg);
    } finally { setBusy(false); }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.form}
      showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

      {/* Species picker */}
      <Text style={s.secLbl}>PET TYPE</Text>
      <View style={s.speciesGrid}>
        {SPECIES.map(sp => (
          <TouchableOpacity key={sp}
            style={[s.spBtn, f.species === sp && s.spBtnOn]}
            onPress={() => up('species', sp)}>
            <Text style={{ fontSize: 24, marginBottom: 4 }}>{EMOJI[sp]}</Text>
            <Text style={[s.spTxt, f.species === sp && { color: C.primary }]}>{sp}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Field label="Pet Name *" value={f.name} onChangeText={v => up('name', v)}
        placeholder="e.g. Buddy" error={err.name} />

      <Field label="Breed *" value={f.breed} onChangeText={v => up('breed', v)}
        placeholder="e.g. Golden Retriever" error={err.breed} />

      <Field label="Birthday * (YYYY-MM-DD)" value={f.birthday}
        onChangeText={v => up('birthday', v)}
        placeholder="2020-03-15" keyboardType="numeric" error={err.birthday} />

      <Field label="Photo URL (optional)" value={f.photoUrl}
        onChangeText={v => up('photoUrl', v)}
        placeholder="https://…" autoCapitalize="none" autoCorrect={false} />

      <Btn title="Add Pet  🐾" onPress={submit} loading={busy} style={{ marginTop: SP.sm }} />
      <View style={{ height: SP.xxl }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: C.bg },
  list:        { padding: SP.md, paddingBottom: 110 },
  delBtn:      { alignSelf: 'flex-end', marginTop: -SP.sm,
    marginRight: SP.sm, marginBottom: SP.xs, paddingHorizontal: SP.sm },
  delTxt:      { fontSize: FS.xs, color: C.error, fontWeight: '600' },
  fab:         { position:'absolute', bottom:SP.xl, right:SP.lg, width:60, height:60,
    borderRadius:30, backgroundColor:C.primary, alignItems:'center',
    justifyContent:'center', ...SH.lg },
  fabTxt:      { fontSize: 34, color: C.white, lineHeight: 38 },
  form:        { padding: SP.md, paddingBottom: 60 },
  secLbl:      { fontSize: FS.xs, fontWeight: '700', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: SP.sm },
  speciesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.lg },
  spBtn:       { alignItems: 'center', padding: SP.sm, borderRadius: R.md,
    borderWidth: 2, borderColor: C.border, backgroundColor: C.white, minWidth: 76 },
  spBtnOn:     { borderColor: C.primary, backgroundColor: C.primary + '14' },
  spTxt:       { fontSize: FS.xs, fontWeight: '700', color: C.textSub },
});
