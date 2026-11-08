/* ============================================================
   SCRIPT.JS — Portada de Bytes (index.html): "Desensamble".

   Un único SVG fijo con los 8 arcos del isotipo acompaña toda la
   página. Cada escena fijada (sticky) define dónde está cada arco
   según cuánto se ha bajado; entre escenas los estados se mezclan.
   Scroll nativo: un solo bucle requestAnimationFrame, sin librerías.
   Con "reducir movimiento" la página queda estática y legible.
   ============================================================ */
(function () {
    'use strict';

    var root = document.documentElement;
    var motion = root.classList.contains('motion');

    /* ── Menú móvil ── */
    var toggle = document.querySelector('.nav-toggle');
    var links = document.getElementById('nav-links');
    function setMenu(open) {
        links.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
    }
    toggle.addEventListener('click', function () { setMenu(!links.classList.contains('open')); });
    links.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && links.classList.contains('open')) { setMenu(false); toggle.focus(); }
    });
    window.matchMedia('(min-width: 901px)').addEventListener('change', function (e) { if (e.matches) setMenu(false); });

    /* ── Utilidades ── */
    var DEG = Math.PI / 180;
    function clamp(v, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return v < a ? a : v > b ? b : v; }
    function rm(v, a, b) { return clamp((v - a) / (b - a)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function eio(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function eo(t) { return 1 - Math.pow(1 - t, 3); }
    function eo4(t) { return 1 - Math.pow(1 - t, 4); }
    function bump(p, c, w) { var k = (p - c) / w; return Math.exp(-k * k); }

    var topbar = document.querySelector('.topbar');
    var navEl = document.querySelector('.nav');
    var curtain = document.querySelector('.curtain');
    var railLinks = Array.prototype.slice.call(document.querySelectorAll('.rail a'));
    var chapters = railLinks.map(function (a) { return document.getElementById(a.dataset.go); });

    function updateChrome(y, vh) {
        var max = document.documentElement.scrollHeight - vh;
        topbar.style.transform = 'scaleX(' + (max > 0 ? clamp(y / max) : 0).toFixed(4) + ')';
        var cr = curtain.getBoundingClientRect(), nh = navEl.offsetHeight;
        var light = cr.top <= nh && cr.bottom > nh;
        if (navEl.classList.contains('light') !== light) navEl.classList.toggle('light', light);
        var idx = 0;
        for (var i = 0; i < chapters.length; i++) if (chapters[i].offsetTop <= y + vh * .5) idx = i;
        for (var j = 0; j < railLinks.length; j++) {
            var on = j === idx;
            if (railLinks[j].classList.contains('active') !== on) {
                railLinks[j].classList.toggle('active', on);
                if (on) railLinks[j].setAttribute('aria-current', 'true'); else railLinks[j].removeAttribute('aria-current');
            }
        }
    }

    /* ── Sin movimiento: página estática y legible ── */
    if (!motion) {
        var still = function () { updateChrome(window.scrollY, window.innerHeight); };
        window.addEventListener('scroll', still, { passive: true });
        window.addEventListener('resize', still);
        still();
        return;
    }

    /* ============================================================
       MOTOR DE ESCENAS
       ============================================================ */
    var actor = document.querySelector('.actor');
    var arcs = Array.prototype.slice.call(actor.querySelectorAll('.arc'));
    var glowEl = actor.querySelector('.glow');
    var shockEl = actor.querySelector('.shock');

    // Índices: 0 r1 arriba · 1 r1 abajo · 2 r2 izq · 3 r2 der · 4 r3 arriba · 5 r3 abajo · 6 r4 izq · 7 r4 der
    var DIR = [-1, 1, -1, 1, -1, 1, -1, 1];
    var VERT = [1, 1, 0, 0, 1, 1, 0, 0];   // eje de separación local: 1 vertical, 0 horizontal

    var vw = 1440, vh = 900, mob = false, sU = 1, SC = [];
    var L = {};

    function S(x, y, r, s, o, g) { return { x: x, y: y, r: r, s: s, o: o, g: g }; }
    function mixS(a, b, t) {
        return S(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.r, b.r, t), lerp(a.s, b.s, t), lerp(a.o, b.o, t), lerp(a.g, b.g, t));
    }
    function mixP(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s: lerp(a.s, b.s, t), o: lerp(a.o, b.o, t) }; }
    function mixF(A, B, t) {
        var a = new Array(8);
        for (var i = 0; i < 8; i++) a[i] = mixS(A.a[i], B.a[i], t);
        return { a: a, gl: mixP(A.gl, B.gl, t), sh: mixP(A.sh, B.sh, t) };
    }
    function none() { return { x: 0, y: 0, s: 1, o: 0 }; }

    // Un par de mitades: centro, escala, giro del anillo y separación a lo largo de su eje de corte (girado con el anillo).
    function pair(i, cx, cy, s, R, sep, o, g) {
        var c = Math.cos(R * DEG), sn = Math.sin(R * DEG), out = [];
        for (var j = 0; j < 2; j++) {
            var k = i + j, d = DIR[k] * sep, vx = VERT[k] ? 0 : d, vy = VERT[k] ? d : 0;
            out.push(S(cx + vx * c - vy * sn, cy + vx * sn + vy * c, R, s, o, g));
        }
        return out;
    }
    function scatter(i, p, spin) {
        var b = SC[i], ring = i >> 1;
        return S(b.x, b.y, b.r + spin * p * (ring % 2 ? -1 : 1), b.s, b.o, 0);
    }

    // Disperso: piezas a los bordes (fracciones del viewport, giro, escala relativa)
    var SCN = [
        [-.41, -.31, -25, .44], [.41, .33, -25, .44],
        [-.45, .30, 35, .40], [.46, -.29, 35, .40],
        [-.12, .52, 160, .52], [.13, -.55, 160, .52],
        [-.47, -.03, -30, .62], [.47, .04, -30, .62]
    ];
    var SCN_M = [
        [-.42, -.30, -25, .62], [.42, .33, -25, .62],
        [-.46, .17, 35, .6], [.47, -.15, 35, .6],
        [-.2, .5, 160, .7], [.22, -.5, 160, .7],
        [-.5, -.05, -30, .9], [.5, .06, -30, .9]
    ];

    var t = 0, PX = 0, PY = 0, tPX = 0, tPY = 0;

    function voice(time) {
        var env = Math.pow(Math.max(0, Math.sin(time * .95) * .5 + .55), .7);
        var syl = Math.abs(Math.sin(time * 7.3)) * .6 + Math.abs(Math.sin(time * 11.7 + 1.3)) * .4;
        return clamp(env * syl);
    }

    /* ---------- Escena 0+1: hero y desarme ---------- */
    function fInicio(p) {
        var H = L.hero, s0 = H.w / 880, big = Math.min(vw * .94, vh * 1.04) / 880;
        var zoom = eio(rm(p, .03, .5)), d = eio(rm(p, .05, .6)), q = eio(rm(p, .62, .97));
        var idle = 1 - rm(p, 0, .12);
        var cx = lerp(H.x, 0, zoom), cy = lerp(H.y, 0, zoom), s = lerp(s0, big, zoom);
        var m = Math.min(vw, vh);
        var R = [70 * d, -50 * d, 100 * d, -140 * d];
        var idl = [
            Math.sin(t * .5) * 3 + PX * 6,
            -(Math.sin(t * .43 + 1) * 3 + PX * 5),
            Math.sin(t * .37 + 2) * 4 + PY * 6,
            -(Math.sin(t * .6 + 3) * 5 + PY * 8)
        ];
        var mult = [1 + .52 * d, 1 + .3 * d, 1 + .15 * d, 1 + .05 * d];
        var sep = [.3 * d * m, .27 * d * m, .2 * d * m, .15 * d * m];
        var dim = lerp(1, mob ? .2 : .34, rm(p, .1, .25));
        var a = [];
        for (var ring = 0; ring < 4; ring++) {
            var par = (ring + 1) * 5 * idle;
            var pr = pair(ring * 2, cx + PX * par, cy + PY * par, s * mult[ring], R[ring] + idl[ring] * idle, sep[ring], dim, ring === 3 ? d : 0);
            a.push(pr[0], pr[1]);
        }
        if (q > 0) for (var i = 0; i < 8; i++) a[i] = mixS(a[i], scatter(i, 0, 0), q);
        return {
            a: a,
            gl: { x: cx, y: cy, s: s * 520 * (1 + .6 * d), o: .75 * (1 - .5 * d) * (1 - q) },
            sh: none()
        };
    }

    /* ---------- Escena 2: servicios (lentes) ---------- */
    function lens(rect, radU, which) {
        var hw = rect.w / 2, hh = rect.h / 2, R, inner, sep;
        if (!mob) {
            R = Math.min(vh * .38, Math.max(rect.h * .8, 170));
            inner = R * R - hh * hh > 0 ? Math.sqrt(R * R - hh * hh) : 0;
            sep = Math.max(0, hw - inner) + 40;
            return { x: rect.x, y: rect.y, s: R / radU, rot: which === 0 ? -90 : 0, sep: sep };
        }
        R = Math.min(vw * .45, 200);
        inner = R * R - hw * hw > 0 ? Math.sqrt(R * R - hw * hw) : 0;
        sep = Math.max(0, hh - inner) + 26;
        return { x: rect.x, y: rect.y, s: R / radU, rot: which === 0 ? 0 : 90, sep: sep };
    }
    function fServ(p) {
        var a = eo(rm(p, 0, .17)), b = eio(rm(p, .43, .6));
        var W = lens(L.web, 403, 0), Y = lens(L.sys, 310, 1);
        var wob = Math.sin(t * .9) * 2.5, br = Math.sin(t * 1.3) * 5;
        var out = [];
        for (var i = 0; i < 8; i++) out.push(scatter(i, p, 24));
        var lw = pair(0, W.x, W.y, W.s, W.rot + wob, W.sep + br, 1, 0);
        var ly = pair(2, Y.x, Y.y, Y.s, Y.rot - wob, Y.sep - br, 1, 0);
        for (var j = 0; j < 2; j++) {
            var sc0 = out[j];
            var exit = S(sc0.x, sc0.y, sc0.r + 180, sc0.s, sc0.o, 0);
            out[j] = mixS(mixS(sc0, lw[j], a), exit, b);
            out[2 + j] = mixS(out[2 + j], ly[j], b);
        }
        var gx = lerp(W.x, Y.x, b), gy = lerp(W.y, Y.y, b);
        return {
            a: out,
            gl: { x: gx, y: gy, s: Math.min(vw, vh) * .5, o: .35 * Math.max(a * (1 - b), b) * (1 - Math.min(a * (1 - b), b) * .6) },
            sh: none()
        };
    }

    /* ---------- Escena 3: ANA (el núcleo habla) ---------- */
    function fAna(p) {
        var A = L.ana, s = A.w / 880 * 1.4, a = eo(rm(p, 0, .3)), a2 = eo(rm(p, .08, .4)), v = voice(t);
        var out = [];
        for (var i = 0; i < 8; i++) out.push(scatter(i, p, 36));
        var r4 = pair(6, A.x, A.y, s * (1 + .04 * v), 0, s * (8 + 34 * v), 1, 1);
        var r3 = pair(4, A.x, A.y, s, t * 24 + p * 120, 0, 1, .22);
        var r2 = pair(2, A.x, A.y, s, -t * 9 - p * 60 + 90, s * 10, .3, 0);
        for (var j = 0; j < 2; j++) {
            out[6 + j] = mixS(out[6 + j], r4[j], a);
            out[4 + j] = mixS(out[4 + j], r3[j], a);
            out[2 + j] = mixS(out[2 + j], r2[j], a2);
        }
        for (var k = 0; k < 2; k++) out[k].o = lerp(out[k].o, .14, a);
        return {
            a: out,
            gl: { x: A.x, y: A.y, s: A.w * .7 * (1 + .14 * v), o: a * (.6 + .3 * v) },
            sh: none()
        };
    }

    /* ---------- Escena 5: trayectoria (rearme) ---------- */
    var WIN = [[.64, .78], [.64, .78], [.41, .53], [.41, .53], [.35, .47], [.35, .47], [.08, .21], [.08, .21]];
    var ORI = [
        [-.95, -.85, 140, 3.4], [.95, .85, -140, 3.4],
        [-.85, .8, -170, 1.8], [.85, -.8, 170, 1.8],
        [.06, -1, 210, 2.2], [-.06, 1, -210, 2.2],
        [-.85, .2, -260, 1.5], [.85, -.2, 260, 1.5]
    ];
    var LAND = [.21, .47, .53, .78];
    function fTray(p) {
        var Tr = L.tray, s = Tr.w / 880;
        var home = [];
        for (var ring = 0; ring < 4; ring++) {
            var pr = pair(ring * 2, Tr.x, Tr.y, s, 0, 0, 1, 0);
            home.push(pr[0], pr[1]);
        }
        var out = [];
        for (var i = 0; i < 8; i++) {
            var u = rm(p, WIN[i][0], WIN[i][1]), e = eo4(u), es = eo(u), o = ORI[i];
            var pop = 1 + .07 * bump(p, WIN[i][1] + .012, .014);
            var flash = bump(p, WIN[i][1], .03);
            out.push(S(
                lerp(Tr.x + o[0] * vw, home[i].x, e),
                lerp(Tr.y + o[1] * vh, home[i].y, e),
                lerp(o[2], 0, es),
                lerp(s * o[3], s, es) * pop,
                clamp(u * 5),
                Math.max(i >= 6 ? .9 * clamp(u * 3) : 0, flash)
            ));
        }
        var fl = 0, sh = none();
        for (var k = 0; k < LAND.length; k++) {
            fl = Math.max(fl, bump(p, LAND[k], .035));
            var dt = (p - LAND[k]) / .09;
            if (dt >= 0 && dt <= 1) {
                var rr = [122, 216, 310, 403][k] + 26;
                sh = { x: Tr.x, y: Tr.y, s: rr * s * (1 + dt * .55), o: (1 - dt) * .9 };
            }
        }
        return {
            a: out,
            gl: { x: Tr.x, y: Tr.y, s: Tr.w * .62 * (1 + .3 * fl), o: .14 + .55 * fl + .3 * rm(p, .78, .92) },
            sh: sh
        };
    }

    /* ---------- Escena 6: CTA ---------- */
    function fCta(p) {
        var C = L.cta, s = C.w / 880;
        var R = [
            Math.sin(t * .3) * 3 + p * 16,
            -(Math.sin(t * .27 + 1) * 4 + p * 24),
            Math.sin(t * .33 + 2) * 5 + p * 32,
            -(Math.sin(t * .4 + 3) * 6 + p * 44)
        ];
        var out = [];
        for (var ring = 0; ring < 4; ring++) {
            var pr = pair(ring * 2, C.x, C.y, s, R[ring], 0, 1, ring === 3 ? 1 : 0);
            out.push(pr[0], pr[1]);
        }
        return {
            a: out,
            gl: { x: C.x, y: C.y, s: C.w * .55 * (1 + .05 * Math.sin(t * 2)), o: .7 },
            sh: none()
        };
    }

    /* ---------- DOM de cada escena ---------- */
    var q = function (sel, ctx) { return (ctx || document).querySelector(sel); };
    var qa = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

    var heroTxt = q('.hero-txt'), cue = q('.cue');
    var stK = q('.st-k'), stSub = q('.st-sub'), words = qa('.st-title .w');
    var hud = q('.hud'), hudNum = q('.hud b'), hudBar = q('.hud .bar i');
    var svcWeb = q('[data-svc="web"]'), svcSys = q('[data-svc="sys"]');
    var bgWeb = q('.bgword', svcWeb), bgSys = q('.bgword', svcSys);
    var anaStage = q('#ana .stage');
    var trayHead = q('.tray-head'), years = qa('.year'), draw = q('.timeline .draw'), tnodes = qa('.tnodes li');
    var ctaStage = q('#contacto .stage');
    var statement = q('.statement');
    var lastPct = -1, trOut = -1;

    function op(el, o, ty) {
        el.style.opacity = o.toFixed(3);
        el.style.transform = 'translate3d(0,' + ty.toFixed(1) + 'px,0)';
    }

    function dInicio(p) {
        var hOut = rm(p, .012, .085);
        op(heroTxt, 1 - hOut, -hOut * 70);
        cue.style.opacity = (1 - rm(p, 0, .03)).toFixed(3);
        var out = rm(p, .66, .8);
        for (var i = 0; i < words.length; i++) {
            var w = rm(p, .24 + i * .022, .31 + i * .022), ew = eo(w);
            op(words[i], ew * (1 - out), (1 - ew) * 56 - out * 40);
        }
        op(stK, rm(p, .21, .26) * (1 - out), 0);
        op(stSub, rm(p, .44, .51) * (1 - out), (1 - eo(rm(p, .44, .51))) * 20);
        statement.style.setProperty('--veil', (rm(p, .2, .3) * (1 - out)).toFixed(3));
        hud.style.opacity = (rm(p, .06, .12) * (1 - rm(p, .86, .96))).toFixed(3);
        var pct = Math.round(eio(rm(p, .05, .6)) * 100);
        if (pct !== lastPct) {
            lastPct = pct;
            hudNum.textContent = (pct < 10 ? '00' : pct < 100 ? '0' : '') + pct + '%';
            hudBar.style.transform = 'scaleX(' + (pct / 100) + ')';
        }
    }
    function dServ(p) {
        svcWeb.classList.toggle('on', p > .07 && p < .47);
        svcSys.classList.toggle('on', p > .57);
        bgWeb.style.transform = 'translate(-50%,-50%) translate3d(' + ((.25 - p) * vw * .35).toFixed(1) + 'px,0,0)';
        bgSys.style.transform = 'translate(-50%,-50%) translate3d(' + ((.8 - p) * vw * .35).toFixed(1) + 'px,0,0)';
    }
    function dAna(p) { anaStage.classList.toggle('on', p > .14); }
    function dTray(p) {
        trayHead.classList.toggle('on', p > .01);
        var idx = p < .06 ? -1 : p < .33 ? 0 : p < .62 ? 1 : 2;
        for (var i = 0; i < years.length; i++) {
            var on = i === idx;
            if (years[i].classList.contains('on') !== on) years[i].classList.toggle('on', on);
        }
        draw.style.transform = 'scaleX(' + eio(rm(p, .04, .86)).toFixed(4) + ')';
        tnodes[0].classList.toggle('on', p >= .2);
        tnodes[1].classList.toggle('on', p >= .52);
        tnodes[2].classList.toggle('on', p >= .77);
    }
    function dCta(p) { ctaStage.classList.toggle('on', p > .04); }

    var scenes = [
        { id: 'inicio', fn: fInicio, dom: dInicio },
        { id: 'servicios', fn: fServ, dom: dServ },
        { id: 'ana', fn: fAna, dom: dAna },
        { id: 'trayectoria', fn: fTray, dom: dTray },
        { id: 'contacto', fn: fCta, dom: dCta }
    ];
    scenes.forEach(function (s) {
        s.el = document.getElementById(s.id);
        s.stage = q('.stage', s.el);
        s.lastP = -1;
    });
    var byId = {};
    scenes.forEach(function (s) { byId[s.id] = s; });

    function slotOf(el, stage) {
        var r = el.getBoundingClientRect(), st = stage.getBoundingClientRect();
        return { x: r.left - st.left + r.width / 2 - vw / 2, y: r.top - st.top + r.height / 2 - vh / 2, w: r.width, h: r.height };
    }

    function measure() {
        vw = actor.clientWidth || window.innerWidth;
        vh = actor.clientHeight || window.innerHeight;
        mob = vw < 761;
        sU = Math.min(vw, vh) / 880;
        actor.setAttribute('viewBox', (-vw / 2) + ' ' + (-vh / 2) + ' ' + vw + ' ' + vh);
        L.hero = slotOf(q('[data-slot="hero"]'), byId.inicio.stage);
        L.web = slotOf(q('.svc-inner', svcWeb), byId.servicios.stage);
        L.sys = slotOf(q('.svc-inner', svcSys), byId.servicios.stage);
        L.ana = slotOf(q('[data-slot="ana"]'), byId.ana.stage);
        L.tray = slotOf(q('[data-slot="tray"]'), byId.trayectoria.stage);
        L.cta = slotOf(q('[data-slot="cta"]'), byId.contacto.stage);
        var src = mob ? SCN_M : SCN, sm = sU;
        SC = src.map(function (c) { return S(c[0] * vw, c[1] * vh, c[2], c[3] * sm, .28, 0); });
        scenes.forEach(function (s) {
            s.a = s.el.offsetTop;
            s.b = s.a + Math.max(1, s.el.offsetHeight - s.stage.offsetHeight);
            s.lastP = -1;
        });
    }

    function frameAt(y) {
        var n = scenes.length, s, nx;
        if (y <= scenes[0].b) { s = scenes[0]; return s.fn(rm(y, s.a, s.b)); }
        for (var k = 0; k < n; k++) {
            s = scenes[k];
            if (y >= s.a && y <= s.b) return s.fn((y - s.a) / (s.b - s.a));
            nx = scenes[k + 1];
            if (nx && y > s.b && y < nx.a) {
                var span = Math.min(vh, nx.a - s.b);
                var tt = eio(clamp((y - s.b) / span));
                if (tt >= 1) return nx.fn(0);
                return mixF(s.fn(1), nx.fn(0), tt);
            }
        }
        var last = scenes[n - 1], F = last.fn(1), dy = -(y - last.b);
        for (var i = 0; i < 8; i++) F.a[i].y += dy;
        F.gl.y += dy; F.sh.y += dy;
        return F;
    }

    var GRAY = [226, 227, 225], LIME = [63, 174, 79];
    function render(F) {
        for (var i = 0; i < 8; i++) {
            var a = F.a[i], el = arcs[i];
            el.setAttribute('transform', 'translate(' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ') rotate(' + a.r.toFixed(2) + ') scale(' + Math.max(.0001, a.s).toFixed(4) + ')');
            el.setAttribute('opacity', clamp(a.o).toFixed(3));
            var g = clamp(a.g);
            el.setAttribute('stroke', 'rgb(' + Math.round(lerp(GRAY[0], LIME[0], g)) + ',' + Math.round(lerp(GRAY[1], LIME[1], g)) + ',' + Math.round(lerp(GRAY[2], LIME[2], g)) + ')');
        }
        glowEl.setAttribute('transform', 'translate(' + F.gl.x.toFixed(1) + ' ' + F.gl.y.toFixed(1) + ') scale(' + Math.max(.0001, F.gl.s).toFixed(2) + ')');
        glowEl.setAttribute('opacity', clamp(F.gl.o).toFixed(3));
        shockEl.setAttribute('transform', 'translate(' + F.sh.x.toFixed(1) + ' ' + F.sh.y.toFixed(1) + ') scale(' + Math.max(.0001, F.sh.s).toFixed(2) + ')');
        shockEl.setAttribute('opacity', clamp(F.sh.o).toFixed(3));
    }

    function doms(y) {
        for (var k = 0; k < scenes.length; k++) {
            var s = scenes[k], p = clamp((y - s.a) / (s.b - s.a));
            if (Math.abs(p - s.lastP) > 1e-5) { s.lastP = p; s.dom(p); }
        }
        // Al soltar la trayectoria, su texto y su línea de tiempo se desvanecen
        // para no cruzarse con el logo, que viaja hacia el contacto.
        var tr = byId.trayectoria, o = 1 - clamp((y - tr.b) / (vh * .35));
        if (Math.abs(o - trOut) > 1e-4) { trOut = o; tr.stage.style.opacity = o.toFixed(3); }
    }

    /* ── Bucle ── */
    var ys = window.scrollY, last = 0, dirty = true;
    function tick(now) {
        var dt = last ? Math.min(.1, (now - last) / 1000) : .016;
        last = now;
        t = now / 1000;
        var y = window.scrollY;
        var k = 1 - Math.pow(1 - .2, dt * 60);
        ys += (y - ys) * k;
        if (Math.abs(y - ys) < .4) ys = y;
        PX += (tPX - PX) * .05; PY += (tPY - PY) * .05;
        if (dirty) { measure(); dirty = false; }
        render(frameAt(ys));
        doms(ys);
        updateChrome(y, vh);
        requestAnimationFrame(tick);
    }

    window.addEventListener('resize', function () { dirty = true; });
    window.addEventListener('load', function () { dirty = true; });
    if (window.matchMedia('(hover: hover)').matches) {
        window.addEventListener('pointermove', function (e) {
            tPX = e.clientX / window.innerWidth * 2 - 1;
            tPY = e.clientY / window.innerHeight * 2 - 1;
        }, { passive: true });
    }

    /* ── Riel: saltar al momento justo de cada capítulo ── */
    var GO = { inicio: 0, servicios: .26, ana: .55, trayectoria: .25, contacto: .4 };
    railLinks.forEach(function (a) {
        a.addEventListener('click', function (e) {
            var id = a.dataset.go, s = byId[id], top;
            if (s) top = id === 'inicio' ? 0 : s.a + (s.b - s.a) * GO[id];
            else top = document.getElementById(id).offsetTop - 40;
            e.preventDefault();
            window.scrollTo({ top: top, behavior: 'smooth' });
            history.replaceState(null, '', '#' + id);
        });
    });

    /* ── Teclado: si el foco entra en un bloque oculto de una escena, llevar el scroll hasta él ── */
    document.addEventListener('focusin', function (e) {
        var host = e.target.closest && e.target.closest('[data-at]');
        if (!host) return;
        var sc = host.closest('.scene');
        var s = sc && byId[sc.id];
        if (!s) return;
        var top = s.a + (s.b - s.a) * parseFloat(host.dataset.at);
        if (Math.abs(window.scrollY - top) > vh * .25) window.scrollTo({ top: top, behavior: 'instant' });
    });

    /* ── Tarjetas de navegación: entrada escalonada ── */
    var cards = qa('.card');
    if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
        }, { threshold: .18 });
        cards.forEach(function (c) { io.observe(c); });
    } else {
        cards.forEach(function (c) { c.classList.add('in'); });
    }

    /* Al cargar con un ancla (#ana, etc.) */
    if (location.hash && byId[location.hash.slice(1)]) {
        window.addEventListener('load', function () {
            measure();
            var id = location.hash.slice(1), s = byId[id];
            if (id !== 'inicio') window.scrollTo({ top: s.a + (s.b - s.a) * GO[id], behavior: 'instant' });
        });
    }

    measure();
    requestAnimationFrame(tick);
})();
