import { useState, useEffect } from "react";
import InstIcon from "../../components/InstIcon";
import {
  adminDb,
  institutionDb,
  useLocalState,
  addLog,
  customRoleDb,
} from "../../db";
import { AppDialog, useDialog } from "../../components/AppDialog";
import { PERM_GROUPS, ALL_PERMS } from "../../permissions";
import { getAdminSession, setAdminSession } from "../../api/auth";
import { can } from "../../permissions";

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
};

const ROLE_BADGE: Record<string, string> = {
  superadmin: "badge-purple",
  admin: "badge-blue",
  moderator: "badge-orange",
};

const EMPTY_FORM = {
  name: "",
  email: "",
  role: "",
  username: "",
  password: "",
  permissions: [] as string[],
  institutions: [] as string[],
};

// ── Müəssisə əhatəsi seçimi (checkbox-lar) ──
function InstSelector({
  institutions,
  value,
  onChange,
}: {
  institutions: any[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((c) => c !== id) : [...value, id]);
  return (
    <div style={{ border: "1.5px solid #e8eaf5", borderRadius: 12, overflow: "hidden", marginTop: 14 }}>
      <div style={{ padding: "9px 14px", background: "#f8f9fd", borderBottom: "1.5px solid #eef0f8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#3b5a7d", textTransform: "uppercase", letterSpacing: 0.5 }}>
          🏛️ Müəssisə əhatəsi {value.length > 0 ? `(${value.length})` : "(hamısı)"}
        </span>
        <button type="button" onClick={() => onChange([])}
          style={{ fontSize: 11, fontWeight: 700, color: "#999", background: "none", border: "none", cursor: "pointer" }}>
          Hamısı
        </button>
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, color: "#8892b0", marginBottom: 2 }}>
          Heç biri seçilməsə hesab BÜTÜN müəssisələri görür. Seçilsə yalnız işarələnənləri.
        </div>
        {institutions.map((inst) => (
          <label key={inst.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: value.includes(inst.id) ? "#3a4cad" : "#555" }}>
            <input type="checkbox" checked={value.includes(inst.id)} onChange={() => toggle(inst.id)} style={{ accentColor: "#1f3f6b" }} />
            {inst.label}
          </label>
        ))}
        {institutions.length === 0 && (
          <span style={{ fontSize: 12, color: "#999" }}>Müəssisə tapılmadı</span>
        )}
      </div>
    </div>
  );
}

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
            color: "#3b5a7d",
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
              color: "#1f3f6b",
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
                  style={{ accentColor: "#1f3f6b" }}
                />
                <span
                  style={{ fontSize: 12.5, fontWeight: 800, color: "#152c4d" }}
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
                      style={{ accentColor: "#1f3f6b" }}
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
  const [customRoles, setCustomRoles] = useState<string[]>([]);
  useEffect(() => {
    customRoleDb.getAll().then(setCustomRoles);
  }, []);
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

  const session = getAdminSession();
  const isSuperAdmin = session?.role === "superadmin";
  // Hesabları yaratmaq/silmək/redaktə etmək — yalnız admins.manage (backend ilə eyni şərt).
  // Superadmin üçün can() həmişə true qaytarır.
  const canManage = can("admins.manage");

  // Hesabın müəssisə əhatəsini seçmək üçün siyahı
  const [institutions, setInstitutions] = useState<any[]>([]);
  useEffect(() => {
    institutionDb.getAll().then(setInstitutions);
  }, []);

  function openPwModal(a: any) {
    setPwTarget(a);
    setPwCurrent("");
    setPwNew("");
    setPwNew2("");
    setPwError("");
    setPwModal(true);
  }

  async function handleChangePw() {
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
    await adminDb.update(pwTarget.id, { password: pwNew });
    // Öz şifrəsini dəyişirsə sessionı yenilə
    if (pwTarget?.id === session?.id) {
      setAdminSession({ ...(session as any), password: pwNew });
    }
    await refresh();
    setPwModal(false);
    await addLog(
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

  const needsPerms = !!form.role && form.role !== "superadmin";

  async function addCustomRole() {
    const n = newRole.trim();
    if (!n) return;
    await customRoleDb.add(n);
    setCustomRoles(await customRoleDb.getAll());
    setForm((f) => ({ ...f, role: n }));
    setAddingRole(false);
    setNewRole("");
  }

  async function confirmRoleDelete() {
    const superadmin = (await adminDb.getAll() as any[]).find((a: any) => a.role === "superadmin");
    const ok = superadmin && (await adminDb.loginAdmin(superadmin.username, rolePw));
    if (!ok) {
      setRolePwError("Superadmin şifrəsi yanlışdır");
      return;
    }
    const r = roleToDelete!;
    await customRoleDb.remove(r);
    setCustomRoles(await customRoleDb.getAll());
    setForm((f) => (f.role === r ? { ...f, role: "" } : f));
    setRoleToDelete(null);
    setRolePw("");
    setRolePwError("");
    await addLog("admin", "warning", `Rol silindi: "${r}"`, "Superadmin şifrəsi ilə təsdiqləndi");
  }

  async function handleAdd() {
    if (!form.name || !form.username || !form.password || !form.role) return;
    await adminDb.create({
      name: form.name,
      email: form.email,
      role: form.role,
      username: form.username.trim(),
      password: form.password,
      permissions: needsPerms ? form.permissions : undefined,
      institutions: needsPerms && form.institutions.length ? form.institutions : undefined,
    });
    await addLog(
      "admin",
      "success",
      `Yeni hesab yaradıldı: "${form.name}" (${ROLES[form.role] || form.role})`,
      `@${form.username.trim()}${needsPerms ? ` · ${form.permissions.length} icazə` : ""}`,
    );
    await refresh();
    setModal(false);
    setForm({ ...EMPTY_FORM });
  }

  // ── İcazə redaktə modalı ──
  const [permTarget, setPermTarget] = useState<any>(null);
  const [permSel, setPermSel] = useState<string[]>([]);
  const [permInst, setPermInst] = useState<string[]>([]);
  function openPerms(a: any) {
    setPermTarget(a);
    setPermSel(a.permissions || []);
    setPermInst(a.institutions || []);
  }
  async function savePerms() {
    await adminDb.update(permTarget.id, { permissions: permSel, institutions: permInst.length ? permInst : null });
    await addLog(
      "admin",
      "info",
      `İcazələr yeniləndi: "${permTarget.name}"`,
      `${permSel.length} icazə`,
      session?.name,
    );
    await refresh();
    setPermTarget(null);
  }

  if (!admins) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        Yüklənir...
      </div>
    );
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
      onConfirm: async () => {
        await adminDb.delete(a.id);
        await refresh();
        await addLog(
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
              <InstSelector institutions={institutions} value={permInst} onChange={setPermInst} />
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
                      placeholder="Məs: admin2"
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
                </div>

                {/* Sağ sütun: icazə + müəssisə əhatəsi — admin / moderator üçün */}
                {needsPerms && (
                  <div>
                    <PermSelector
                      value={form.permissions}
                      onChange={(v) => setForm((f) => ({ ...f, permissions: v }))}
                    />
                    <InstSelector
                      institutions={institutions}
                      value={form.institutions}
                      onChange={(v) => setForm((f) => ({ ...f, institutions: v }))}
                    />
                  </div>
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
            <div className="card-sub">Admin hesabları</div>
          </div>
          {canManage && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setForm({ ...EMPTY_FORM });
                setModal(true);
              }}
            >
              + Hesab Yarat
            </button>
          )}
        </div>
        <div className="card-body" style={{ overflowX: "auto" }}>
          <table style={{ minWidth: 620 }}>
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
                          background: "linear-gradient(135deg,#1f3f6b,#4a6f8f)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 15,
                          color: "#fff",
                          fontWeight: 800,
                        }}
                      >
                        {a.name[0]}
                      </div>
                      <span style={{ fontWeight: 700 }}>{a.name}</span>
                    </div>
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>
                    {a.email || <span style={{ fontFamily: "monospace" }}>@{a.username}</span>}
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
                      {a.username && (canManage || a.id === session?.id) && (
                        <button
                          className="btn-ghost"
                          title="Şifrəni dəyiş"
                          onClick={() => openPwModal(a)}
                          style={{
                            color: "#1f3f6b",
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
                      {isSuperAdmin && a.role !== "superadmin" && (
                          <button
                            className="btn-ghost"
                            title="İcazələr"
                            onClick={() => openPerms(a)}
                            style={{
                              color: "#152c4d",
                              border: "1.5px solid #d5c5ff",
                              borderRadius: 8,
                              padding: "4px 10px",
                              background: "#f8f4ff",
                              fontSize: 13,
                              whiteSpace: "nowrap",
                            }}
                          >
                            🛡️ {(a.permissions || []).length}
                          </button>
                        )}
                      {canManage && a.role !== "superadmin" && (
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
    </>
  );
}
