import { P, O } from '../palette'
// "İxtisas seçimi necə aparılır?" təlimatı üçün GIF-ə bənzər animasiya:
// siçan ⠿ işarəsindən tutub sonuncu sətri ən yuxarıya sürüşdürür, sonra dövr təkrarlanır.
// Sətirlər təhsilalanın öz strukturundan gəlir (ən çox 3), sütunlar strukturun səviyyələrinə uyğundur.
// Şəkil faylı deyil, CSS animasiyasıdır — yüngüldür, şəbəkəyə yük salmır.
const STEP = 36

function css(n: number) {
  const up = (n - 1) * STEP
  return `
.dd-wrap{position:relative;width:100%;height:${n * STEP + 10}px;animation:dd-fade 6s infinite}
.dd-row{position:absolute;left:0;right:0;height:30px;display:flex;align-items:center;gap:6px;
  padding:0 8px;background:#fff;border:1.5px solid #e6e8f0;border-radius:8px;font-size:12px;font-weight:700;color:#2b2f3a}
.dd-head{display:flex;align-items:center;gap:6px;padding:5px 9.5px;margin-bottom:2px;background:${P.line3};
  border:1.5px solid ${P.line};border-radius:8px;font-size:10px;font-weight:800;color:${O(P.navyDk, '#5a4a12')};text-transform:uppercase;letter-spacing:.4px}
.dd-head .c:first-child,.dd-row .c:first-child{flex:0 0 74px}
.dd-head .c{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dd-head .c+.c{padding-left:6px;border-left:1px solid ${P.line}}
.dd-head .h{padding:0 5px;border:1px solid transparent;font-size:12px}
.dd-row .c{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dd-row .c+.c{border-left:1px solid #eceef4;padding-left:6px;font-weight:600;color:#4a5060}
.dd-row .h{color:#8a909c;background:#f0f2fa;border:1px solid #e0e4f0;border-radius:5px;padding:0 5px;font-weight:800;flex-shrink:0}
.dd-other{animation:dd-down 6s infinite}
.dd-last{z-index:2;animation:dd-up 6s infinite}
.dd-cur{position:absolute;right:4px;top:${(n - 1) * STEP + 14}px;z-index:3;font-size:18px;line-height:1;pointer-events:none;
  filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));animation:dd-cur 6s infinite}
@keyframes dd-down{0%,30%{transform:none}55%,100%{transform:translateY(${STEP}px)}}
@keyframes dd-up{
  0%,18%{transform:none;box-shadow:none;border-color:#e6e8f0}
  25%{transform:scale(1.03);box-shadow:0 6px 16px rgba(0,0,0,.15);border-color:${O(P.navy, '#e0a92e')}}
  55%{transform:translateY(-${up}px) scale(1.03);box-shadow:0 6px 16px rgba(0,0,0,.15);border-color:${O(P.navy, '#e0a92e')}}
  65%,100%{transform:translateY(-${up}px);box-shadow:none;border-color:#34a36b}}
@keyframes dd-cur{
  0%{transform:translate(20px,30px);opacity:0}
  12%{opacity:1}
  18%{transform:none}
  25%{transform:scale(.85)}
  55%{transform:translateY(-${up}px) scale(.85)}
  65%{transform:translateY(-${up}px)}
  85%,100%{transform:translate(20px,-${up + 20}px);opacity:0}}
@keyframes dd-fade{0%,88%{opacity:1}94%{opacity:0}100%{opacity:1}}
@media (prefers-reduced-motion:reduce){.dd-wrap,.dd-wrap *{animation:none!important}}
`
}

// Sabit nümunə — bütün strukturlar üçün eyni göstərilir
const HEADERS = ['Qoşun növü', 'Mülki ixtisas', 'Hərbi uçot ixtisası']
const ROWS = [
  ['QQ', 'Menecment', 'Motoatıcı'],
  ['HHQ', 'Aerokosmik mühəndisliyi', 'Pilot'],
  ['HDQ', 'Dəniz naviqasiyası', 'Ştruman'],
]

export default function DragDemo() {
  const list = ROWS, headers = HEADERS
  const n = list.length
  return (
    <div style={{ flex: '0 1 400px', minWidth: 260, background: '#f6f7fb', border: '1px solid #e8eaf2', borderRadius: 10, padding: '8px 10px' }}>
      <style>{css(n)}</style>
      {headers.length > 0 && (
        <div className="dd-head" aria-hidden="true">
          {list[0].map((_, j) => <span key={j} className="c">{headers[j] || ''}</span>)}
          <span className="h" style={{ visibility: 'hidden' }}>⠿</span>
        </div>
      )}
      <div className="dd-wrap" aria-hidden="true">
        {list.map((cells, i) => (
          <div key={i} className={`dd-row ${i === n - 1 ? 'dd-last' : 'dd-other'}`} style={{ top: 4 + i * STEP }}>
            {cells.map((c, j) => <span key={j} className="c">{c}</span>)}
            <span className="h">⠿</span>
          </div>
        ))}
        <div className="dd-cur">👆</div>
      </div>
      <div style={{ fontSize: 10.5, color: '#8a909c', textAlign: 'center', marginTop: 2, fontWeight: 600 }}>
        ⠿ işarəsindən tutub yuxarı çəkin
      </div>
    </div>
  )
}
