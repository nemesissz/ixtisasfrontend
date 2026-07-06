import { useState } from "react";
import InstIcon from "../../components/InstIcon";
import {
  adminDb,
  systemSettingsDb,
  institutionDb,
  userDb,
  useLocalState,
  addLog,
  InstLoginConfig,
  STUDENT_COLUMNS,
  studentColValue,
  customRoleDb,
} from "../../db";
import { AppDialog, useDialog } from "../../components/AppDialog";
import { PERM_GROUPS, ALL_PERMS } from "../../permissions";

const EyeIcon = ({ off }: { off: boolean }) =>
  off ? (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

const ROLES: Record<string, string> = {
  superadmin: "Baş Admin",
  admin: "Admin",
  moderator: "Moderator",
  operator: "Operator",
};

const ROLE_BADGE: Record<string, string> = {
  superadmin: "badge-purple",
  admin: "badge-blue",
  moderator: "badge-orange",
  operator: "badge-green",
};

const EMPTY_FORM = {
  name: "",
  email: "",
  role: "",
  username: "",
  password: "",
  permissions: [] as string[],
};

// ── İcazə seçimi (checkbox qrupları) ──
function PermSelector({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (code: string) =>
    onChange(
      value.includes(code) ? value.filter((c) => c !== code) : [...value, code],
    );
  const toggleGroup = (codes: string[]) => {
    const allOn = codes.every((c) => value.includes(c));
    onChange(
      allOn
        ? value.filter((c) => !codes.includes(c))
        : [...new Set([...value, ...codes])],
    );
  };
  return (
    <div
      style={{
        border: "1.5px solid #e8eaf5",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "9px 14px",
          background: "#f8f9fd",
          borderBottom: "1.5px solid #eef0f8",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "#9a7b1e",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          🛡️ İcazələr ({value.length}/{ALL_PERMS.length})
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => onChange([...ALL_PERMS])}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#c9962a",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Hamısı
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#999",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Heç biri
          </button>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "14px 20px",
          padding: "12px 16px",
        }}
      >
        {PERM_GROUPS.map((g) => {
          const codes = g.perms.map((p) => p.code);
          const allOn = codes.every((c) => value.includes(c));
          return (
            <div
              key={g.group}
              style={{
                background: "#fafbff",
                border: "1px solid #eef0f8",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  cursor: "pointer",
                  marginBottom: 7,
                }}
              >
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => toggleGroup(codes)}
                  style={{ accentColor: "#c9962a" }}
                />
                <span
                  style={{ fontSize: 12.5, fontWeight: 800, color: "#5a4a12" }}
                >
                  {g.icon} {g.group}
                </span>
              </label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  paddingLeft: 22,
                }}
              >
                {g.perms.map((p) => (
                  <label
                    key={p.code}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      color: value.includes(p.code) ? "#3a4cad" : "#888",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={value.includes(p.code)}
                      onChange={() => toggle(p.code)}
                      style={{ accentColor: "#c9962a" }}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Admins() {
  const [admins, refresh] = useLocalState(adminDb.getAll);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showPw, setShowPw] = useState(false);
  const [customRoles, setCustomRoles] = useState<string[]>(() => customRoleDb.getAll());
  const [addingRole, setAddingRole] = useState(false);
  const [newRole, setNewRole] = useState("");
  const [roleToDelete, setRoleToDelete] = useState<string | null>(null);
  const [rolePw, setRolePw] = useState("");
  const [rolePwError, setRolePwError] = useState("");
  const { dialog, showConfirm, showInfo, closeDialog } = useDialog();

  // Şifrə dəyişmə state
  const [pwModal, setPwModal] = useState(false);
  const [pwTarget, setPwTarget] = useState<any>(null);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwShowC, setPwShowC] = useState(false);
  const [pwShowN, setPwShowN] = useState(false);
  const [pwError, setPwError] = useState("");

  const session = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("admin_session") || "null");
    } catch {
      return null;
    }
  })();
  const isSuperAdmin = session?.role === "superadmin";

  const institutions = institutionDb.getAll() as any[];
  const [selInst, setSelInst] = useState<string>(institutions[0]?.id || "");
  const [instCfg, setInstCfg] = useState<InstLoginConfig>(() =>
    systemSettingsDb.getInstConfig(institutions[0]?.id || ""),
  );
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [redirectDelay, setRedirectDelay] = useState<number>(() =>
    systemSettingsDb.getRedirectDelay(),
  );

  function handleInstChange(id: string) {
    setSelInst(id);
    setInstCfg(systemSettingsDb.getInstConfig(id));
  }

  function handleSaveSettings() {
    systemSettingsDb.setInstConfig(selInst, instCfg);
    systemSettingsDb.setRedirectDelay(redirectDelay);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
    addLog(
      "admin",
      "success",
      "Giriş parametrləri yeniləndi",
      `Müəssisə: ${selInst} · Yönləndirmə: ${redirectDelay}s`,
      session?.name,
    );
  }

  // ── Yalnız bu müəssisənin təhsilalan datasında mövcud olan sütunlar ──
  const instCadets = (userDb.getAll() as any[]).filter(
    (u: any) => u.institution === selInst,
  );
  const availColumns0 = STUDENT_COLUMNS.filter((c) =>
    instCadets.some(
      (u: any) => studentColValue(u, c.key).trim() !== "",
    ),
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

  function openPwModal(a: any) {
    setPwTarget(a);
    setPwCurrent("");
    setPwNew("");
    setPwNew2("");
    setPwError("");
    setPwModal(true);
  }

  function handleChangePw() {
    if (!pwNew || !pwNew2) {
      setPwError("Bütün sahələri doldurun");
      return;
    }
    // Superadmin öz şifrəsini dəyişəndə cari şifrə yoxlanır
    if (pwTarget?.id === session?.id) {
      if (!pwCurrent) {
        setPwError("Cari şifrəni daxil edin");
        return;
      }
      if (pwTarget.password !== pwCurrent) {
        setPwError("Cari şifrə yanlışdır");
        return;
      }
    }
    if (pwNew.length < 6) {
      setPwError("Yeni şifrə ən azı 6 simvol olmalıdır");
      return;
    }
    if (pwNew !== pwNew2) {
      setPwError("Yeni şifrələr uyğun gəlmir");
      return;
    }
    adminDb.update(pwTarget.id, { password: pwNew });
    // Öz şifrəsini dəyişirsə sessionı yenilə
    if (pwTarget?.id === session?.id) {
      sessionStorage.setItem("admin_session", JSON.stringify({ ...session, password: pwNew }));
    }
    refresh();
    setPwModal(false);
    addLog(
      "admin",
      "success",
      `Şifrə dəyişdirildi: ${pwTarget.name}`,
      "",
      session?.name,
    );
    showInfo({
      icon: "✅",
      iconBg: "#f0fff4",
      iconColor: "#52c41a",
      title: "Şifrə dəyişdirildi",
      message: "Yeni şifrə uğurla yadda saxlanıldı.",
      confirmLabel: "Bağla",
    });
  }

  const isOperator = form.role === "operator";
  const needsPerms = !!form.role && form.role !== "superadmin";

  function addCustomRole() {
    const n = newRole.trim();
    if (!n) return;
    customRoleDb.add(n);
    setCustomRoles(customRoleDb.getAll());
    setForm((f) => ({ ...f, role: n }));
    setAddingRole(false);
    setNewRole("");
  }

  function confirmRoleDelete() {
    const superadmin = (adminDb.getAll() as any[]).find((a: any) => a.role === "superadmin");
    if (!superadmin || rolePw !== superadmin.password) {
      setRolePwError("Superadmin şifrəsi yanlışdır");
      return;
    }
    const r = roleToDelete!;
    customRoleDb.remove(r);
    setCustomRoles(customRoleDb.getAll());
    setForm((f) => (f.role === r ? { ...f, role: "" } : f));
    setRoleToDelete(null);
    setRolePw("");
    setRolePwError("");
    addLog("admin", "warning", `Rol silindi: "${r}"`, "Superadmin şifrəsi ilə təsdiqləndi");
  }

  function handleAdd() {
    if (!form.name || !form.username || !form.password || !form.role) return;
    adminDb.create({
      name: form.name,
      email: isOperator ? "" : form.email,
      role: form.role,
      username: form.username.trim(),
      password: form.password,
      permissions: needsPerms ? form.permissions : undefined,
    });
    addLog(
      "admin",
      "success",
      `Yeni hesab yaradıldı: "${form.name}" (${ROLES[form.role] || form.role})`,
      `@${form.username.trim()}${needsPerms ? ` · ${form.permissions.length} icazə` : ""}`,
    );
    refresh();
    setModal(false);
    setForm({ ...EMPTY_FORM });
  }

  // ── İcazə redaktə modalı ──
  const [permTarget, setPermTarget] = useState<any>(null);
  const [permSel, setPermSel] = useState<string[]>([]);
  function openPerms(a: any) {
    setPermTarget(a);
    setPermSel(a.permissions || []);
  }
  function savePerms() {
    adminDb.update(permTarget.id, { permissions: permSel });
    addLog(
      "admin",
      "info",
      `İcazələr yeniləndi: "${permTarget.name}"`,
      `${permSel.length} icazə`,
      session?.name,
    );
    refresh();
    setPermTarget(null);
  }

  function handleDelete(a: any) {
    if (a.role === "superadmin") {
      showInfo({
        icon: "🔒",
        iconBg: "#fff0f0",
        iconColor: "#cf1322",
        title: "Silinə bilməz",
        message: "Baş Admin (superadmin) hesabını silmək mümkün deyil.",
        confirmLabel: "Bağla",
      });
      return;
    }
    showConfirm({
      icon: "🗑️",
      iconBg: "#fff0f0",
      iconColor: "#ff4d4f",
      title: "Hesabı sil",
      message: `"${a.name}" hesabı silinəcək. Bu əməliyyat geri alına bilməz.`,
      confirmLabel: "Sil",
      confirmColor: "#ff4d4f",
      onConfirm: () => {
        adminDb.delete(a.id);
        refresh();
        addLog(
          "admin",
          "warning",
          `Hesab silindi: "${a.name}" (${ROLES[a.role] || a.role})`,
          `id: ${a.id}`,
        );
      },
    });
  }

  return (
    <>
      {dialog && <AppDialog cfg={dialog} onClose={closeDialog} />}

      {/* ── Rol silmə təsdiqi (superadmin şifrəsi) ── */}
      {roleToDelete && (
        <div className="modal-overlay open" style={{ zIndex: 3000 }} onClick={() => { setRoleToDelete(null); setRolePw(""); setRolePwError(""); }}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head" style={{ borderBottom: "none", paddingBottom: 0 }}>
              <span style={{ fontSize: 20 }}>🗑️</span>
              <button className="modal-close" onClick={() => { setRoleToDelete(null); setRolePw(""); setRolePwError(""); }}>✕</button>
            </div>
            <div className="modal-body" style={{ paddingTop: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
                Rolu silmək istəyirsiniz?
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.5 }}>
                <b>«{roleToDelete}»</b> rolu sistemdən silinəcək. Təsdiq üçün <b>Superadmin şifrəsini</b> daxil edin.
              </div>
              <div style={{ marginBottom: 8 }}>
                <label className="form-label">Superadmin şifrəsi *</label>
                <input
                  className="form-input"
                  type="password"
                  value={rolePw}
                  autoFocus
                  onChange={(e) => { setRolePw(e.target.value); setRolePwError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmRoleDelete(); }}
                />
                {rolePwError && <div style={{ fontSize: 12, color: "#cf1322", marginTop: 6 }}>{rolePwError}</div>}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
                <button className="btn btn-outline" onClick={() => { setRoleToDelete(null); setRolePw(""); setRolePwError(""); }}>Ləğv</button>
                <button className="btn btn-danger" disabled={!rolePw} onClick={confirmRoleDelete}>Sil</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Şifrə dəyişmə modalı ── */}
      {pwModal && pwTarget && (
        <div className="modal-overlay open" onClick={() => setPwModal(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 420 }}
          >
            <div className="modal-head">
              <span className="modal-title">
                🔑 Şifrəni Dəyiş — {pwTarget.name}
              </span>
              <button className="modal-close" onClick={() => setPwModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {/* Cari şifrə — yalnız öz hesabı üçün */}
              {pwTarget.id === session?.id && (
                <div className="form-group">
                  <label className="form-label">Cari şifrə *</label>
                  <div style={{ position: "relative" }}>
                    <input
                      className="form-input"
                      type={pwShowC ? "text" : "password"}
                      placeholder="Mövcud şifrəni daxil edin"
                      value={pwCurrent}
                      onChange={(e) => {
                        setPwCurrent(e.target.value);
                        setPwError("");
                      }}
                      style={{ paddingRight: 44 }}
                    />
                    <button
                      type="button"
                      onClick={() => setPwShowC((v) => !v)}
                      title={pwShowC ? "Gizlət" : "Göstər"}
                      style={{
                        position: "absolute",
                        right: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--muted)",
                        padding: 4,
                        lineHeight: 0,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <EyeIcon off={pwShowC} />
                    </button>
                  </div>
                </div>
              )}

              {/* Yeni şifrə */}
              <div className="form-group">
                <label className="form-label">Yeni şifrə *</label>
                <div style={{ position: "relative" }}>
                  <input
                    className="form-input"
                    type={pwShowN ? "text" : "password"}
                    placeholder="Ən azı 6 simvol"
                    value={pwNew}
                    onChange={(e) => {
                      setPwNew(e.target.value);
                      setPwError("");
                    }}
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setPwShowN((v) => !v)}
                    title={pwShowN ? "Gizlət" : "Göstər"}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--muted)",
                      padding: 4,
                      lineHeight: 0,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <EyeIcon off={pwShowN} />
                  </button>
                </div>
              </div>

              {/* Təkrar */}
              <div className="form-group">
                <label className="form-label">Yeni şifrəni təkrarla *</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="Yeni şifrəni yenidən daxil edin"
                  value={pwNew2}
                  onChange={(e) => {
                    setPwNew2(e.target.value);
                    setPwError("");
                  }}
                />
              </div>

              {pwError && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: "#fff0f0",
                    border: "1px solid #ffccc7",
                    color: "#cf1322",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  ⚠ {pwError}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-outline"
                onClick={() => setPwModal(false)}
              >
                Ləğv et
              </button>
              <button className="btn btn-primary" onClick={handleChangePw}>
                🔑 Şifrəni yenilə
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── İcazə redaktə modalı ── */}
      {permTarget && (
        <div className="modal-overlay open" onClick={() => setPermTarget(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 780, width: "94vw" }}
          >
            <div className="modal-head">
              <span className="modal-title">
                🛡️ İcazələr — {permTarget.name}
              </span>
              <button
                className="modal-close"
                onClick={() => setPermTarget(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: "82vh" }}>
              <PermSelector value={permSel} onChange={setPermSel} />
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-outline"
                onClick={() => setPermTarget(null)}
              >
                Ləğv et
              </button>
              <button className="btn btn-primary" onClick={savePerms}>
                ✓ Yadda saxla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Yeni hesab modalı ── */}
      {modal && (
        <div className="modal-overlay open" onClick={() => setModal(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: needsPerms ? 1020 : 480,
              width: "94vw",
              transition: "max-width .2s",
            }}
          >
            <div className="modal-head">
              <span className="modal-title">➕ Yeni Hesab</span>
              <button className="modal-close" onClick={() => setModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: "85vh" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: needsPerms ? "300px 1fr" : "1fr",
                  gap: needsPerms ? 22 : 0,
                  alignItems: "start",
                }}
              >
                <div>
                  {/* Rol */}
                  <div className="form-group">
                    <label className="form-label">Rol *</label>
                    <select
                      className="form-select"
                      value={addingRole ? "__new__" : form.role}
                      onChange={(e) => {
                        if (e.target.value === "__new__") { setAddingRole(true); setNewRole(""); }
                        else { setAddingRole(false); setForm((f) => ({ ...f, role: e.target.value })); }
                      }}
                    >
                      <option value="" disabled>Rol seçin…</option>
                      {customRoles.map((r) => (
                        <option key={r} value={r}>{ROLES[r] || r}</option>
                      ))}
                      <option value="__new__">➕ Yeni rol əlavə et…</option>
                    </select>
                    {addingRole && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <input
                          className="form-input"
                          placeholder="Yeni rol adı (məs: Nəzarətçi)"
                          value={newRole}
                          autoFocus
                          onChange={(e) => setNewRole(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomRole(); } }}
                        />
                        <button type="button" className="btn btn-primary btn-sm" disabled={!newRole.trim()} onClick={addCustomRole}>
                          Əlavə et
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setAddingRole(false); setNewRole(""); }}>
                          Ləğv
                        </button>
                      </div>
                    )}
                    {customRoles.length > 0 && !addingRole && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {customRoles.map((r) => (
                          <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 10px", borderRadius: 20, background: "#f4f7ff", border: "1.5px solid #c5d0ff", fontSize: 11, fontWeight: 700, color: "#3a4cad" }}>
                            {r}
                            <button type="button" title="Rolu sil" onClick={() => { setRoleToDelete(r); setRolePw(""); setRolePwError(""); }}
                              style={{ background: "#ffd6d6", border: "none", color: "#cf1322", cursor: "pointer", fontSize: 10, lineHeight: 1, padding: "2px 5px", borderRadius: "50%", fontWeight: 900 }}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Ad Soyad */}
                  <div className="form-group">
                    <label className="form-label">Ad Soyad *</label>
                    <input
                      className="form-input"
                      placeholder="Məs: Əli Məmmədov"
                      value={form.name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                  </div>

                  {/* İstifadəçi adı + şifrə (bütün rollar üçün) */}
                  <div className="form-group">
                    <label className="form-label">İstifadəçi adı *</label>
                    <input
                      className="form-input"
                      placeholder={
                        isOperator ? "Məs: operator1" : "Məs: admin2"
                      }
                      value={form.username}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, username: e.target.value }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Şifrə *</label>
                    <div style={{ position: "relative" }}>
                      <input
                        className="form-input"
                        type={showPw ? "text" : "password"}
                        placeholder="Güclü şifrə daxil edin"
                        value={form.password}
                        style={{ paddingRight: 44 }}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, password: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((p) => !p)}
                        title={showPw ? "Gizlət" : "Göstər"}
                        style={{
                          position: "absolute",
                          right: 12,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--muted)",
                          padding: 4,
                          lineHeight: 0,
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <EyeIcon off={showPw} />
                      </button>
                    </div>
                  </div>

                  {!isOperator && (
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input
                        className="form-input"
                        type="email"
                        placeholder="Məs: admin@mmu.az"
                        value={form.email}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, email: e.target.value }))
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Sağ sütun: icazə seçimi — admin / moderator / operator üçün */}
                {needsPerms && (
                  <PermSelector
                    value={form.permissions}
                    onChange={(v) => setForm((f) => ({ ...f, permissions: v }))}
                  />
                )}
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-outline"
                onClick={() => setModal(false)}
              >
                Ləğv et
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={!form.name || !form.username || !form.password}
                style={{
                  opacity:
                    !form.name || !form.username || !form.password ? 0.5 : 1,
                }}
              >
                ✓ Əlavə et
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cədvəl ── */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Sistem İstifadəçiləri</div>
            <div className="card-sub">Admin və operator hesabları</div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setForm({ ...EMPTY_FORM });
              setModal(true);
            }}
          >
            + Hesab Yarat
          </button>
        </div>
        <div className="card-body">
          <table>
            <thead>
              <tr>
                <th>Ad Soyad</th>
                <th>Giriş məlumatı</th>
                <th>Rol</th>
                <th>Status</th>
                <th>Son Giriş</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(admins as any[]).map((a: any) => (
                <tr key={a.id}>
                  <td>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          flexShrink: 0,
                          background:
                            a.role === "operator"
                              ? "linear-gradient(135deg,#00b96b,#007a47)"
                              : "linear-gradient(135deg,#c9962a,#b8860b)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 15,
                          color: "#fff",
                          fontWeight: 800,
                        }}
                      >
                        {a.role === "operator" ? "🛠️" : a.name[0]}
                      </div>
                      <span style={{ fontWeight: 700 }}>{a.name}</span>
                    </div>
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>
                    {a.role === "operator" ? (
                      <span style={{ fontFamily: "monospace" }}>
                        @{a.username}
                      </span>
                    ) : (
                      a.email
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${ROLE_BADGE[a.role] || "badge-gray"}`}
                    >
                      {ROLES[a.role] || a.role}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${a.status === "active" ? "badge-green" : "badge-red"}`}
                    >
                      {a.status === "active" ? "Aktiv" : "Deaktiv"}
                    </span>
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: 11 }}>
                    {a.lastLogin || "—"}
                  </td>
                  <td>
                    <div
                      style={{ display: "flex", gap: 6, alignItems: "center" }}
                    >
                      {a.username && (
                        <button
                          className="btn-ghost"
                          title="Şifrəni dəyiş"
                          onClick={() => openPwModal(a)}
                          style={{
                            color: "#c9962a",
                            border: "1.5px solid #c5d0ff",
                            borderRadius: 8,
                            padding: "4px 10px",
                            background: "#f4f7ff",
                            fontSize: 13,
                          }}
                        >
                          🔑
                        </button>
                      )}
                      {isSuperAdmin &&
                        (a.role === "admin" ||
                          a.role === "moderator" ||
                          a.role === "operator") && (
                          <button
                            className="btn-ghost"
                            title="İcazələr"
                            onClick={() => openPerms(a)}
                            style={{
                              color: "#b8860b",
                              border: "1.5px solid #d5c5ff",
                              borderRadius: 8,
                              padding: "4px 10px",
                              background: "#f8f4ff",
                              fontSize: 13,
                            }}
                          >
                            🛡️ {(a.permissions || []).length}
                          </button>
                        )}
                      {a.role !== "superadmin" && (
                        <button
                          className="btn-ghost"
                          onClick={() => handleDelete(a)}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {(admins as any[]).length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      color: "var(--muted)",
                      padding: 40,
                    }}
                  >
                    Hesab yoxdur
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* ── Giriş Parametrləri (yalnız superadmin) ── */}
      {isSuperAdmin && (
        <div className="card" style={{ marginTop: 20, overflow: "hidden" }}>
          {/* Başlıq */}
          <div
            style={{
              background: "linear-gradient(135deg,#b8860b,#e0a92e)",
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
                  background: "linear-gradient(135deg,#c9962a,#b8860b)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  boxShadow: "0 4px 14px #c9962a44",
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
                  color: selInst === inst.id ? "#c9962a" : "#8892b0",
                  borderBottom:
                    selInst === inst.id
                      ? "2px solid #c9962a"
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
                    accent: "#c9962a",
                    accentBg: "#fbf1d6",
                    field: instCfg.field1,
                    setF: setF1,
                  },
                  {
                    title: "Parol",
                    icon: "🔑",
                    accent: "#b8860b",
                    accentBg: "#fbf1d6",
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
                          color: "#9a7b1e",
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
                          color: "#9a7b1e",
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
                              color: "#9a7b1e",
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
                        border: `1.5px solid ${field.required ? accent + "44" : "#efe1bd"}`,
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
                            color: field.required ? accent : "#9a7b1e",
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
                        color: "#9a7b1e",
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
                border: "1.5px solid #e0a92e33",
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#fbf1d6",
                  padding: "14px 20px",
                  borderBottom: "1px solid #e0a92e22",
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
                    background: "#c9962a",
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
                  style={{ fontSize: 13, fontWeight: 700, color: "#9a7b1e" }}
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
                    borderColor: "#e0a92e33",
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
    </>
  );
}
