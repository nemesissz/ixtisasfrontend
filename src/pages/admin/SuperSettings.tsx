import { useState, useEffect } from "react";
import { useActiveInst } from '../../activeInst'
import InstIcon from "../../components/InstIcon";
import {
  systemSettingsDb,
  institutionDb,
  userDb,
  addLog,
  InstLoginConfig,
  DEFAULT_INST_CONFIG,
  STUDENT_COLUMNS,
  studentColValue,
} from "../../db";
import { getAdminSession } from "../../api/auth";
import MonitorSettingsCard from "../../components/MonitorSettingsCard";
import ThemeSettingsCard from "../../components/ThemeSettingsCard";
import { P, O } from '../../palette'

/**
 * Superadmin parametrləri — yalnız baş admin görür.
 * Təhsilalan giriş sahələri, yönləndirmə müddəti və təsdiqdən sonrakı elan
 * buradadır; "Adminlər" bölməsində yalnız sistem istifadəçiləri qalır.
 */
export default function SuperSettings() {
  const session = getAdminSession();
  const isSuperAdmin = session?.role === "superadmin";

  const [institutions, setInstitutions] = useState<any[]>([]);
  const [selInst, setSelInst] = useActiveInst(institutions);
  const [instCfg, setInstCfg] = useState<InstLoginConfig>(DEFAULT_INST_CONFIG);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [redirectDelay, setRedirectDelay] = useState<number>(10);
  // Təsdiqdən sonrakı elan (boşdursa təhsilalana göstərilmir)
  const [submitNotice, setSubmitNotice] = useState<string>("");
  const [noticeSaved, setNoticeSaved] = useState(false);

  useEffect(() => {
    institutionDb.getAll().then((list: any[]) => {
      setInstitutions(list);
      if (!list.some((i: any) => i.id === selInst)) setSelInst(list[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    if (!selInst) return;
    systemSettingsDb.getInstConfig(selInst).then(setInstCfg);
  }, [selInst]);

  useEffect(() => {
    systemSettingsDb.getRedirectDelay().then(setRedirectDelay);
    systemSettingsDb.getSubmitNotice().then((v) => setSubmitNotice(v || ""));
  }, []);

  async function handleSaveNotice() {
    const text = (submitNotice || "").trim();
    await systemSettingsDb.setSubmitNotice(text);
    setSubmitNotice(text);
    setNoticeSaved(true);
    setTimeout(() => setNoticeSaved(false), 2000);
    await addLog(
      "admin",
      "success",
      text ? "Təsdiq elanı yeniləndi" : "Təsdiq elanı silindi",
      text ? text.slice(0, 200) : "—",
      session?.name,
    );
  }

  function handleInstChange(id: string) {
    setSelInst(id);
  }

  async function handleSaveSettings() {
    await systemSettingsDb.setInstConfig(selInst, instCfg);
    await systemSettingsDb.setRedirectDelay(redirectDelay);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
    await addLog(
      "admin",
      "success",
      "Giriş parametrləri yeniləndi",
      `Müəssisə: ${selInst} · Yönləndirmə: ${redirectDelay}s`,
      session?.name,
    );
  }

  // ── Yalnız bu müəssisənin təhsilalan datasında mövcud olan sütunlar ──
  const [allStudents, setAllStudents] = useState<any[]>([]);
  useEffect(() => {
    userDb.getAll().then((list: any[]) => setAllStudents(list));
  }, []);
  const instCadets = allStudents.filter((u: any) => u.institution === selInst);
  const availColumns0 = STUDENT_COLUMNS.filter((c) =>
    instCadets.some((u: any) => studentColValue(u, c.key).trim() !== ""),
  );
  const availColumns = availColumns0.length ? availColumns0 : STUDENT_COLUMNS; // təhsilalan yoxdursa hamısını göstər
  const colOptions = (selectedKey: string) =>
    availColumns.some((c) => c.key === selectedKey)
      ? availColumns
      : [
          STUDENT_COLUMNS.find((c) => c.key === selectedKey)!,
          ...availColumns,
        ].filter(Boolean);

  function setF1(k: keyof InstLoginConfig["field1"], v: any) {
    setInstCfg((c) => ({ ...c, field1: { ...c.field1, [k]: v } }));
  }
  function setF2(k: keyof InstLoginConfig["field2"], v: any) {
    setInstCfg((c) => ({ ...c, field2: { ...c.field2, [k]: v } }));
  }

  // Səhifə marşrutda da qorunur; bu, əlavə təhlükəsizlik qatıdır.
  if (!isSuperAdmin) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        Bu bölmə yalnız baş admin üçündür.
      </div>
    );
  }

  return (
    <>
      {/* ── Giriş Parametrləri (yalnız superadmin) ── */}
      {isSuperAdmin && (
        <div className="card" style={{ marginTop: 20, overflow: "hidden" }}>
          {/* Başlıq */}
          <div
            style={{
              background: `linear-gradient(135deg,${O(P.navy, '#b8860b')},${P.steel})`,
              padding: "20px 28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#fff",
                  marginBottom: 3,
                }}
              >
                ⚙️ Təhsilalan Giriş Parametrləri
              </div>
              <div style={{ fontSize: 12, color: "#ffffffcc" }}>
                Müəssisəyə görə giriş sahələrini təyin edin
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {settingsSaved && (
                <span
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    background: "#f0fff4",
                    color: "#237804",
                    fontSize: 12,
                    fontWeight: 700,
                    border: "1px solid #b7eb8f",
                  }}
                >
                  ✅ Yadda saxlanıldı
                </span>
              )}
              <button
                onClick={handleSaveSettings}
                style={{
                  padding: "9px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: `linear-gradient(135deg,${P.navy},${O(P.steel, '#b8860b')})`,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  boxShadow: `0 4px 14px ${P.navy}44`,
                }}
              >
                💾 Yadda Saxla
              </button>
            </div>
          </div>

          {/* Müəssisə tab sətri */}
          <div
            style={{
              background: "#f4f6ff",
              borderBottom: "2px solid #e8ecff",
              padding: "0 28px",
              display: "flex",
              gap: 2,
            }}
          >
            {institutions.map((inst: any) => (
              <button
                key={inst.id}
                onClick={() => handleInstChange(inst.id)}
                style={{
                  padding: "13px 20px",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  background: "transparent",
                  transition: "all .15s",
                  color: selInst === inst.id ? `${P.navy}` : "#8892b0",
                  borderBottom:
                    selInst === inst.id
                      ? `2px solid ${P.navy}`
                      : "2px solid transparent",
                  marginBottom: -2,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, maxWidth: 240 }}>
                  <InstIcon icon={inst.icon} size={18} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inst.label}</span>
                </span>
              </button>
            ))}
            {institutions.length === 0 && (
              <span
                style={{
                  padding: "13px 0",
                  fontSize: 13,
                  color: "var(--muted)",
                }}
              >
                Müəssisə tapılmadı
              </span>
            )}
          </div>

          {/* Sahə konfiqurasiyası */}
          {selInst && (
            <div
              style={{
                padding: "28px",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 24,
              }}
            >
              {(
                [
                  {
                    title: "İstifadəçi adı",
                    icon: "🪪",
                    accent: `${P.navy}`,
                    accentBg: `${P.tint}`,
                    field: instCfg.field1,
                    setF: setF1,
                  },
                  {
                    title: "Parol",
                    icon: "🔑",
                    accent: `${P.navyDk}`,
                    accentBg: `${P.tint}`,
                    field: instCfg.field2,
                    setF: setF2,
                  },
                ] as const
              ).map(({ title, icon, accent, accentBg, field, setF }) => (
                <div
                  key={title}
                  style={{
                    border: `1.5px solid ${accent}33`,
                    borderRadius: 14,
                    overflow: "hidden",
                  }}
                >
                  {/* Kart başlığı */}
                  <div
                    style={{
                      background: accentBg,
                      padding: "14px 20px",
                      borderBottom: `1px solid ${accent}22`,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        background: accent,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        flexShrink: 0,
                      }}
                    >
                      {icon}
                    </div>
                    <div>
                      <div
                        style={{ fontSize: 13, fontWeight: 800, color: accent }}
                      >
                        {title}
                      </div>
                      <div style={{ fontSize: 11, color: `${accent}99` }}>
                        Giriş formasındakı {title.toLowerCase()} sahəsi
                      </div>
                    </div>
                  </div>

                  {/* Kart gövdəsi */}
                  <div
                    style={{
                      padding: "18px 20px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                      background: "#fff",
                    }}
                  >
                    {/* Sütun seçici */}
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: 11,
                          fontWeight: 700,
                          color: `${P.ink}`,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          marginBottom: 6,
                        }}
                      >
                        Təhsilalan cədvəlindəki sütun
                      </label>
                      <select
                        className="form-select"
                        value={field.column}
                        onChange={(e) => setF("column", e.target.value)}
                        style={{
                          borderColor: `${accent}44`,
                          background: accentBg,
                        }}
                      >
                        {colOptions(field.column).map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Etiket */}
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: 11,
                          fontWeight: 700,
                          color: `${P.ink}`,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          marginBottom: 6,
                        }}
                      >
                        Ekran adı (etiket)
                      </label>
                      <input
                        className="form-input"
                        value={field.label}
                        onChange={(e) => setF("label", e.target.value)}
                        placeholder="Məs: FİN Kodu"
                        style={{ borderColor: `${accent}33` }}
                      />
                    </div>

                    {/* Min / Maks */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                      }}
                    >
                      {[
                        {
                          lbl: "Min uzunluq",
                          key: "min" as const,
                          val: field.min,
                          fn: (v: number) => setF("min", Math.max(0, v)),
                        },
                        {
                          lbl: "Maks uzunluq",
                          key: "max" as const,
                          val: field.max,
                          fn: (v: number) => setF("max", Math.max(1, v)),
                        },
                      ].map((f) => (
                        <div key={f.key}>
                          <label
                            style={{
                              display: "block",
                              fontSize: 11,
                              fontWeight: 700,
                              color: `${P.ink}`,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                              marginBottom: 6,
                            }}
                          >
                            {f.lbl}
                          </label>
                          <input
                            className="form-input"
                            type="number"
                            min={0}
                            max={50}
                            value={f.val}
                            onChange={(e) => f.fn(Number(e.target.value))}
                            style={{
                              textAlign: "center",
                              borderColor: `${accent}33`,
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    {/* Məcburi toggle */}
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        cursor: "pointer",
                        padding: "10px 14px",
                        borderRadius: 10,
                        background: field.required ? accentBg : "#f8f9fd",
                        border: `1.5px solid ${field.required ? accent + "44" : `${P.line2}`}`,
                        transition: "all .15s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={field.required}
                        style={{ width: 16, height: 16, accentColor: accent }}
                        onChange={(e) => setF("required", e.target.checked)}
                      />
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: field.required ? accent : `${P.ink}`,
                          }}
                        >
                          Məcburi sahədir
                        </div>
                        <div style={{ fontSize: 11, color: "#8892b0" }}>
                          {field.required
                            ? "Boş buraxıla bilməz"
                            : "İstəyə bağlıdır"}
                        </div>
                      </div>
                    </label>

                    {/* Xülasə */}
                    <div
                      style={{
                        padding: "8px 14px",
                        borderRadius: 9,
                        background: "#f4f6ff",
                        fontSize: 11,
                        color: `${P.ink}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span>📋</span>
                      <span>
                        <b>
                          {
                            STUDENT_COLUMNS.find((c) => c.key === field.column)
                              ?.label
                          }
                        </b>{" "}
                        sütunu · {field.min}–{field.max} simvol ·{" "}
                        {field.required ? "Məcburi" : "İstəyə bağlı"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Qlobal: seçimdən sonra login-ə qayıtma vaxtı */}
          <div style={{ padding: "0 28px 28px" }}>
            <div
              style={{
                border: `1.5px solid ${O(P.navy, '#e0a92e')}33`,
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: `${P.tint}`,
                  padding: "14px 20px",
                  borderBottom: `1px solid ${O(P.navy, '#e0a92e')}22`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: `${P.navy}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  ⏱️
                </div>
                <div>
                  <div
                    style={{ fontSize: 14, fontWeight: 800, color: "#2b2f3a" }}
                  >
                    Seçimdən sonra login-ə qayıtma
                  </div>
                  <div style={{ fontSize: 11.5, color: "#8892b0" }}>
                    Təhsilalan seçimini tamamlayandan sonra bu müddət keçəndə
                    avtomatik login səhifəsinə qayıdır
                  </div>
                </div>
              </div>
              <div
                style={{
                  padding: "18px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <label
                  style={{ fontSize: 13, fontWeight: 700, color: `${P.ink}` }}
                >
                  Vaxt (saniyə):
                </label>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  max={3600}
                  value={redirectDelay}
                  onChange={(e) =>
                    setRedirectDelay(
                      Math.max(0, Math.round(Number(e.target.value))),
                    )
                  }
                  style={{
                    width: 120,
                    textAlign: "center",
                    borderColor: `${O(P.navy, '#e0a92e')}33`,
                  }}
                />
                <span style={{ fontSize: 12, color: "#8892b0" }}>
                  {redirectDelay === 0
                    ? "Dərhal qayıdır"
                    : `${redirectDelay} saniyə gözləyir`}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Təsdiqdən sonrakı elan (yalnız superadmin) ──────────────────────
          Təhsilalan seçimini təsdiqlədikdən sonra "uğurla qeyd olundu"
          ekranında, avtomatik yenilənmə geri sayımı boyunca göstərilir.
          Boş saxlansa heç nə göstərilmir. */}
      {isSuperAdmin && (
        <div className="card" style={{ marginTop: 20, overflow: "hidden" }}>
          <div style={{ background: `linear-gradient(135deg,${O(P.navy, '#b8860b')},${P.steel})`, padding: "20px 28px" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 3 }}>
              📣 Təsdiqdən Sonrakı Elan
            </div>
            <div style={{ fontSize: 12, color: "#fff9e6" }}>
              Təhsilalan seçimini təsdiqlədikdən sonra ekranda görünəcək mesaj
            </div>
          </div>
          <div style={{ padding: "22px 28px" }}>
            <textarea
              value={submitNotice || ""}
              onChange={(e) => setSubmitNotice(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Məsələn: Sənədlərinizi 20 sentyabr tarixinədək tədris şöbəsinə təqdim edin."
              style={{
                width: "100%", boxSizing: "border-box", resize: "vertical",
                padding: "12px 14px", borderRadius: 10, border: "1.5px solid var(--border)",
                fontSize: 13.5, lineHeight: 1.6, fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={handleSaveNotice}>
                Yadda saxla
              </button>
              {(submitNotice || "").trim() && (
                <button
                  className="btn"
                  onClick={() => { setSubmitNotice(""); systemSettingsDb.setSubmitNotice("").then(() => { setNoticeSaved(true); setTimeout(() => setNoticeSaved(false), 2000); }); }}
                >
                  Elanı sil
                </button>
              )}
              {noticeSaved && (
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#237804" }}>✅ Yadda saxlanıldı</span>
              )}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {(submitNotice || "").trim()
                  ? `${(submitNotice || "").trim().length}/1000 simvol`
                  : "Boşdur — təhsilalana heç nə göstərilmir"}
              </span>
            </div>

            {/* Təhsilalanın görəcəyi görünüş */}
            {(submitNotice || "").trim() && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Təhsilalanın görəcəyi
                </div>
                <div style={{
                  background: `${P.tint2}`, border: `1.5px solid ${O(P.tint, '#f1ead4')}`, borderLeft: `5px solid ${O(P.navy, '#e0a92e')}`,
                  borderRadius: 12, padding: "14px 18px", fontSize: 13.5, color: "#4a5060",
                  lineHeight: 1.7, whiteSpace: "pre-wrap",
                }}>{(submitNotice || "").trim()}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Canlı nəzarət — ümumi açar və intervallar ── */}
      {isSuperAdmin && <MonitorSettingsCard />}

      {/* ── Görünüş rejimi (açıq / tünd / sistem) — bütün proqrama tətbiq olunur ── */}
      {isSuperAdmin && <ThemeSettingsCard />}
    </>
  );
}
