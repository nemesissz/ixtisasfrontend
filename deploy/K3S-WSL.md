# Real Kubernetes (k3s) — WSL2 Ubuntu-da (öyrənmə + davamlı)

**Niyə k3s?** Docker Desktop-un kind klasteri müvəqqətidir (restart-da data itir).
k3s isə **əsl, davamlı, production-səviyyəli** Kubernetes-dir — data diskdə qalır,
NodePort işləyir, və öyrəndiyiniz eyni əmrlər gələcək Ubuntu serverdə də işləyəcək.

**Fərq (öyrənmə üçün):**
| | Docker Desktop (kind) | k3s (WSL/server) |
|---|---|---|
| Konteyner mühərriki | containerd (gizli) | containerd (k3s daxilində) |
| Data | müvəqqəti (restart→itir) | **davamlı** (diskdə) |
| NodePort girişi | ❌ işləmir | ✅ işləyir |
| İstehsala uyğun | yox (test) | **bəli** |

---

## FAZA 0 — Ubuntu quraşdır (Windows PowerShell-də)

```powershell
wsl --install -d Ubuntu
```
- Yenidən başlatma istəsə, edin.
- Ubuntu açılanda **istifadəçi adı + parol** təyin edin (yadda saxlayın).
- Yoxlama: `wsl -l -v` → siyahıda "Ubuntu ... Running ... 2" olmalıdır.

---

## FAZA 1 — k3s quraşdır (Ubuntu içində)

Ubuntu terminalını açın (`wsl -d Ubuntu`), sonra:

```bash
# k3s tək əmrlə qurulur (traefik/ingress-siz — bizə lazım deyil)
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik --write-kubeconfig-mode=644" sh -

# kubectl onsuz da k3s-in içindədir — yoxla
sudo k3s kubectl get nodes
```
→ 1 node "Ready" görünməlidir. **Bu, əsl k3s klasteridir.**

Rahatlıq üçün kubeconfig-i istifadəçiyə bağla:
```bash
mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER ~/.kube/config
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc && source ~/.bashrc
kubectl get nodes        # artıq "sudo k3s" yazmadan işləyir
```

---

## FAZA 2 — App image-lərini k3s-ə yüklə

k3s Docker deyil, **containerd** işlədir. Image-ləri onun anbarına idxal edirik.
`isp-images.tar` faylı (mən hazırladım, `deploy/` qovluğunda) lazımdır.

Windows faylına WSL-dən belə çatmaq olar (`/mnt/c/...`):
```bash
# .tar-ı k3s containerd-ə idxal et
sudo k3s ctr images import "/mnt/c/Users/Tural/Desktop/MMU-İxtisas/deploy/isp-images.tar"

# yoxla — 3 image görünməlidir
sudo k3s ctr images ls | grep -E "mmu-ixtisas|mysql"
```

---

## FAZA 3 — Manifestləri tətbiq et

```bash
# manifest faylını Windows-dan işlət
kubectl apply -f "/mnt/c/Users/Tural/Desktop/MMU-İxtisas/mmu-ixtisas/k8s/isp.yaml"

# pod-lar qalxana qədər izlə
kubectl get pods -n isp -w        # hamısı 1/1 Running olanda Ctrl+C
```

**Frontend-i NodePort ilə aç** (k3s-də işləyir — port-forward lazım deyil):
```bash
kubectl patch svc frontend -n isp -p '{"spec":{"type":"NodePort","ports":[{"port":80,"targetPort":80,"nodePort":30080}]}}'
```

---

## FAZA 4 — Giriş və davamlılıq testi

**WSL-in IP-sini tap:**
```bash
hostname -I | awk '{print $1}'      # məs. 172.x.x.x
```

Brauzerdə aç: **`http://<WSL_IP>:30080`** (admin / Admin@2026)
> Windows-dan `http://localhost:30080` da adətən işləyir (WSL port ötürməsi).

**Davamlılıq sınağı (əsas fərq!):**
```bash
wsl --shutdown           # (Windows PowerShell-də) Ubuntu-nu tam söndür
wsl -d Ubuntu            # yenidən aç
kubectl get pods -n isp  # pod-lar özləri qalxır, DATA QALIR ✅
```
Docker Desktop kind-də data itirdi — k3s-də qalır. Fərqi görəcəksiniz.

---

## Gündəlik əmrlər (k3s)
```bash
kubectl get all -n isp
kubectl logs -n isp deploy/backend
kubectl rollout restart deploy/frontend -n isp
```

## Data köçürmə (Docker Desktop k8s-dən k3s-ə, bir dəfə)
Mövcud 240 tələbəni k3s-ə gətirmək üçün mənə deyin — dump/restore edərəm.
