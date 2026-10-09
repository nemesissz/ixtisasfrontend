# İstifadə: python3 build.py <çıxış.woff2> <miqyas> <mərkəz_y> <lucide-static/font qovluğu>
import json, sys
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.pens.ttGlyphPen import TTGlyphPen
MAP = {
 '✅':'circle-check','⚠':'triangle-alert','📋':'clipboard-list','👥':'users','⚖':'scale','🗑':'trash-2',
 '✏':'pencil','🎓':'graduation-cap','🔒':'lock','📚':'library','⏳':'hourglass','🗄':'archive',
 '📊':'chart-column','🏛':'landmark','🔍':'search','📦':'package','👤':'user','🏫':'school','🎯':'target',
 '👁':'eye','📅':'calendar','❌':'circle-x','🗳':'vote','🔐':'lock-keyhole','💾':'save','🛡':'shield',
 '📥':'download','🏆':'trophy','📭':'inbox','🚀':'rocket','🖼':'image','🖨':'printer','🔑':'key-round',
 '🚫':'ban','⚙':'settings','⚡':'zap','⚔':'swords','⛔':'octagon-x','🔁':'repeat','🔄':'refresh-cw',
 '📄':'file-text','📡':'radio-tower','🐢':'turtle','⏱':'timer','📤':'upload','📝':'notebook-pen',
 '📂':'folder-open','📁':'folder','🌐':'globe','😀':'smile','➕':'plus','✔':'check','📣':'megaphone',
 '⏸':'pause','🕓':'clock','🕐':'clock','📖':'book-open','👆':'pointer','🌓':'sun-moon','🔧':'wrench',
 '⏰':'alarm-clock','⬇':'arrow-down','🏢':'building-2','🔰':'shield-check','📐':'ruler','🏷':'tag',
 '🪪':'id-card','⏵':'play','⏭':'skip-forward','🎬':'clapperboard','📍':'map-pin','🔬':'microscope',
 '📌':'pin','💡':'lightbulb',
}
cp = json.load(open(sys.argv[4] + '/codepoints.json'))
src = TTFont(sys.argv[4] + '/lucide.ttf')
cmap = src.getBestCmap()
rev = {}
for ch,name in MAP.items():
    rev[ord(ch)] = cmap[cp[name]]
# subset to needed glyphs
opts = subset.Options(); opts.notdef_outline=True; opts.name_IDs=['*']; opts.layout_features=[]
s = subset.Subsetter(opts); s.populate(unicodes=[cp[n] for n in set(MAP.values())]+[cp['minus']]); s.subset(src)
m = dict(rev); VS=cmap[cp['minus']]; m[0xFE0F]=VS
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
t4=CmapSubtable.newSubtable(4); t4.platformID=3; t4.platEncID=1; t4.language=0; t4.cmap={k:v for k,v in m.items() if k<=0xFFFF}
t12=CmapSubtable.newSubtable(12); t12.platformID=3; t12.platEncID=10; t12.language=0; t12.cmap=dict(m)
t14=CmapSubtable.newSubtable(14); t14.platformID=0; t14.platEncID=5; t14.language=0; t14.cmap={}
t14.uvsDict={0xFE0F:[(k,None) for k in sorted(rev)], 0xFE0E:[(k,None) for k in sorted(rev)]}
src['cmap'].tables=[t4,t12,t14]
from fontTools.pens.transformPen import TransformPen
SC=float(sys.argv[2]) if len(sys.argv)>2 else 0.9; CY=float(sys.argv[3]) if len(sys.argv)>3 else 340
gs=src.getGlyphSet(); glyf=src['glyf']
for gn in list(src.getGlyphOrder()):
    if gn=='.notdef': continue
    p=TTGlyphPen(None); tp=TransformPen(p,(SC,0,0,SC,500-500*SC,CY-500*SC)); gs[gn].draw(tp)
    glyf[gn]=p.glyph(); src['hmtx'][gn]=(1000,0)
    if gn==VS: glyf[gn]=TTGlyphPen(None).glyph(); src['hmtx'][gn]=(0,0)
for rec in src['name'].names:
    if rec.nameID in (1,4,6,16):
        rec.string = 'IspIcons'
src.flavor = 'woff2'
src.save(sys.argv[1])
print('ok', len(m), src['head'].unitsPerEm, src['hhea'].ascent, src['hhea'].descent)
