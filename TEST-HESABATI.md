# MMU-İSP — Sistem Test Hesabatı və Düzəliş Planı

**Tarix:** 2026-06-22
**Əhatə:** İxtisas seçimi və bölüşdürmə strukturunun bütün üsulları, kənar-halları və potensial problemləri
**Metod:** Real alqoritmin dəqiq güzgüsü ilə standalone kənar-hal batareyaları + kod auditi + canlı brauzer yoxlaması

---

## 1. Test edilən komponentlər

| Komponent | Fayl | Test üsulu |
|---|---|---|
| Sadə üsul (greedy + max-flow tarazlama) | `Distribution.tsx` → `runPlacement` + `rebalanceUnplaced` | 11 kənar-hal sim + invariant yoxlaması |
| Paket üsulu (deficit kvota bölgüsü) | `Distribution.tsx` → `packets` useMemo + `runPacketPlacement` | 6 bölgü sim + invariant |
| Gale-Shapley + tarazlama | `Distribution.tsx` → `runGaleShapley` | kod auditi + build |
| Cins məhdudiyyəti (allowFemale/maxFemale) | `genderAllowed` / `genderCapReached` | bütün simlərdə invariant |
| Mənbə-proporsional (mülki/lisey) | `runPlacement` sourceProportional | kod auditi |
| Bazaya yazma / təmizləmə | `handleConfirm` | kod auditi (əvvəl düzəldilib) |
| Qismən Bölgü | `Redistribute.tsx` → `computePartial` / `handleApply` | kod auditi |
| Snapshot / Rollback | `Distribution.tsx` / `Redistribute.tsx` | kod auditi |

---

## 2. Yerləşdirmə nüvəsi — kənar-hal batareyası (11 test)

Hər testdə yoxlanan **invariantlar**: ① kvota aşımı yox, ② ikiqat təyinat yox, ③ kursant yalnız seçdiyi və cinsinə icazəli yerə düşür, ④ maxFemale/maxMale aşılmır, ⑤ gözlənilən yerləşmə sayı.

| Test | Ssenari | Nəticə |
|---|---|---|
| T1 | Yer = kursant (10=10), hamı hamısını seçir | ✅ 10/10 |
| T2 | Yer < kursant (6 yer, 10 nəfər) | ✅ 6/10 (4 obyektiv yerləşmir) |
| T3 | Yer > kursant (20 yer, 5 nəfər) | ✅ 5/5 |
| T4 | 1 ixtisas qadına bağlı (6 qadın + 6 kişi, 12 yer) | ✅ 12/12 |
| T5 | Bütün kursantlar eyni bal (tie) | ✅ 10/10, çökmə yox |
| T6 | Hər 5-ci kursant boş seçim | ✅ 8/10 (boş seçim → yerləşmir) |
| T7 | maxFemale = 2 tavanı | ✅ 16/16, tavan pozulmur |
| T8 | Kvotası 0 olan ixtisas | ✅ 10/10, ora heç kim düşmür |
| T9 | Cinssiz (null) kursantlar | ✅ 10/10 |
| T10 | Hamı yalnız 1 dolu ixtisası seçir (3 yer, 10 nəfər) | ✅ 3/10 |
| T11 | 2 ixtisas qadına bağlı (6 qadın, qadına yalnız 4 yer) | ✅ 10/12 (2 qadın obyektiv yerləşmir) |

**Nəticə:** Sadə üsulun nüvəsi tam etibarlıdır. Yerləşməyən kursant yalnız o zaman qalır ki, **fiziki olaraq** uyğun boş yer yoxdur (yer çatmır və ya cins məhdudiyyəti qadın yerlərini həddən artıq azaldıb). Bu, alqoritm səhvi deyil — config məhdudiyyətidir.

---

## 3. Paket kvota bölgüsü — 6 test

İnvariant: ① hər ixtisasın paket-payları cəmi = ümumi kvota, ② hər paketin kvotası = paketin kursant sayı.

| Test | Ssenari | Nəticə |
|---|---|---|
| P1 | 100 kursant, 4 paket, ümumi kvota **50** | ❌ Zəmanət pozulur (paket: 25 kursant / ~13 yer) |
| P2 | 50 kursant, 4 paket, kvota 50 (yer=kursant) | ✅ |
| P3 | 388 kursant, 8 paket, kvota 388 | ✅ |
| P4 | 7 kursant, 3 paket | ✅ [3,2,2] |
| P5 | Paket sayı > leaf kvota (10 nəfər, 5 paket) | ✅ |
| P6 | 1 paket | ✅ |

**Nəticə:** Bölgü ümumi kvota ≥ kursant olduqda düzgündür. **P1** göstərir ki, ümumi kvota < kursant olanda koddakı zəmanət ("hər paketin kvotası = kursant sayı") pozulur — bu, fiziki olaraq qaçılmazdır (yer yoxdur), amma koddakı şərh yanlış təəssürat yaradır.

---

## 4. Tapılan problemlər (ciddilik üzrə)

### 🔴 Mərhələ 1 — kritik tutarlılıq

**P-1 · Qismən Bölgü-də max-flow tarazlama yoxdur**
- **Fayl:** `Redistribute.tsx` → `computePartial` (sətir ~100)
- **Problem:** Yalnız greedy işləyir. Cins məhdudiyyəti olan ixtisaslarda boş yer + yerləşməyən kursant **eyni anda** qala bilər — bu, əsas bölüşdürmədə həll etdiyimiz problemin eynisidir.
- **Təsir:** Qismən yenidən bölgü optimal nəticə verməyə bilər.

**P-2 · Qismən Bölgü köhnə yerləşməni təmizləmir**
- **Fayl:** `Redistribute.tsx` → `handleApply` (sətir ~159)
- **Problem:** Yalnız `preview`-dəki (yerləşən) kursantlar yenilənir. `pool`-da olub yenidən yerləşməyən kursantın köhnə `placedSpecialtyId`-si bazada qalır.
- **Təsir:** "Tankçı 9/8" tipli **over-quota anomaliyası** (əsas bölüşdürmədə düzəltdiyimiz səhvin eynisi).

### 🟡 Mərhələ 2 — möhkəmləndirmə

**P-6 · Silinmiş ixtisas + yerləşmiş kursant (orfan)**
- **Problem:** İçində yerləşmiş kursant olan ixtisas silinsə, kursantın `placedSpecialtyId`-si "naməlum"a işarə edir.
- **Təsir:** Nəticələr/Statistikada qırıq göstəriş.
- **Həll:** Silmə zamanı xəbərdarlıq + həmin kursantların yerləşməsini təmizlə (və ya "yenidən böl" təklif et).

**P-5 · Gale-Shapley tarazlaması sim ilə təsdiqlənməyib**
- **Problem:** `runGaleShapley`-ə `rebalanceUnplaced` əlavə edildi, amma yalnız build-test olunub.
- **Həll:** Sadə üsul kimi kənar-hal sim batareyası işlət.

### ⚪ Mərhələ 3 — şəffaflıq / sənədləşdirmə

**P-3 · Paket üsulu qlobal optimal deyil**
- **İzah:** Paketlər müstəqil işləyir. B paketindəki aşağı ballı kursant, A paketindəki yüksək ballının istədiyi yeri tuta bilər (çünki o yer A paketinin payında deyil). Bal ədaləti **paket daxilindədir**, qlobal deyil.
- **Status:** Dizayn xüsusiyyəti, səhv deyil. Admin yanlış gözlənti qurmasın deyə interfeysdə qısa qeyd faydalı olar.

**P-4 · Yanlış kod şərhi**
- **Fayl:** `Distribution.tsx` (sətir ~971)
- **Problem:** "hər paketin kvotası = kursant sayı" şərhi yalnız ümumi kvota ≥ kursant olduqda doğrudur.
- **Həll:** Şərhi düzəlt + UI-da "Yer çatmır: N kursant yerləşə bilməyəcək" xəbərdarlığı.

---

## 5. Əvvəlki sessiyalarda artıq düzəldilənlər (təsdiq üçün)

- ✅ **Əsas bölüşdürmə over-quota** — `handleConfirm` köhnə yerləşməni təmizləyir.
- ✅ **Cins məhdudiyyəti boş-yer problemi** — `runPlacement` + `runPacketPlacement`-ə balı qoruyan **max-flow tarazlama** əlavə edildi.
- ✅ **İzahlı simulyasiya** — real nəticəni (tarazlama daxil) göstərir, cins məhdudiyyətinə hörmət edir.
- ✅ **Rəng teması** — bütün platforma açıq + qızılı tonda, 0 mavi/bənövşəyi UI vurğusu, mobil/planşet overflow yoxdur.

---

## 6. Tövsiyə edilən icra sırası

1. **P-2** (Qismən Bölgü təmizləmə) — kritik, kiçik dəyişiklik
2. **P-1** (Qismən Bölgü max-flow tarazlama) — kritik
3. **P-6** (silinmiş ixtisas orfanları) — orta
4. **P-5** (Gale-Shapley sim təsdiqi) — aşağı
5. **P-4** (şərh + UI xəbərdarlıq) — aşağı
6. **P-3** (paket üsulu izah qeydi) — aşağı

**Tövsiyəm:** Mərhələ 1-dən (P-2 + P-1) başlayaq — bunlar əsas bölüşdürmədə həll etdiyimiz ciddi problemlərin Qismən Bölgü-dəki eynisidir.

---

## 7. Yekun qiymət

| Sahə | Vəziyyət |
|---|---|
| Sadə üsul nüvəsi | ✅ Tam etibarlı |
| Cins/tavan/mənbə qaydaları | ✅ Tam riayət |
| Paket kvota bölgüsü | ✅ (kvota ≥ kursant şərti ilə) |
| Qismən Bölgü | ⚠️ 2 tutarlılıq boşluğu (P-1, P-2) |
| Struktur kənar-halları | ⚠️ 1 orfan riski (P-6) |
| Rəng / responsivlik | ✅ Təmiz |

**Ümumi:** Sistemin əsas bölüşdürmə məntiqi möhkəmdir. Qalan risklər əsasən **Qismən Bölgü** modulunda və struktur idarəetməsindədir — hamısı aydın, lokal və həll edilə biləndir.
