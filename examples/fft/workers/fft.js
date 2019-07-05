var global = typeof global === 'undefined' ? self : global;
var exports = typeof exports === 'undefined' ? {} : exports;
var module = typeof module === 'undefined' ? { exports } : module;
var require = typeof require === 'undefined' ? () => { } : require;
"use strict";
var FFT;
(function (FFT) {
    var SharedArrayBuffer = typeof SharedArrayBuffer === 'undefined' ? ArrayBuffer : SharedArrayBuffer;
    FFT.transferableTypes = [...typeof ArrayBuffer !== 'undefined' ? [ArrayBuffer] : [], ...typeof MessagePort !== 'undefined' ? [MessagePort] : [], ...typeof ImageBitmap !== 'undefined' ? [ImageBitmap] : []];
    FFT.transferables = (...objects) => objects.filter(object => object && typeof object === 'object' && FFT.transferableTypes.find(type => object instanceof type));
    const debugging = false;
    const { sin, cos, PI, abs, pow, hypot, imul } = Math, PI2 = 2 * PI, PI64 = 64 * PI;
    const trunc = (v) => ~~(1 * v);
    const floor = (v, t = trunc(v)) => v === t ? t : v >= t ? t : t - 1;
    const ceil = (v, f = floor(v)) => v >= 0 ? f + 1 : f >= v ? f : f + 1;
    const round = (v, t = trunc(v)) => v === t ? t : v >= 0 ? (v - t < 0.5 ? t : t + 1) : (t - v < 0.5 ? t : t - 1);
    const mround = (v, m, t = trunc(v * m) / m) => v === t ? t : v >= 0 ? (v - t < 0.5 ? t : t + 1) : (t - v < 0.5 ? t : t - 1);
    const diagonal = (a, b = a) => ceil(hypot(a, b));
    const now = typeof performance !== 'undefined' && performance.now ? performance.now.bind(performance) : Date.now.bind(Date);
    let cisTables;
    (function (cisTables) {
        const { PI, abs, sin, cos, sqrt, max } = Math;
        const Base = Float32Array;
        class CISTable extends Base {
            constructor(size) {
                super(new SharedArrayBuffer(Base.BYTES_PER_ELEMENT * (size * 1.25)));
                this.size = size;
                const [n, n2, n4, n8] = this.n = [size, size >> 1, size >> 2, size >> 3];
                const t = sin(PI / n), c0 = this[n4] = 1, s0 = this[0] = 0, n2p4 = n2 + n4;
                const dc0 = 2 * (t ** 2), ds0 = max((2 - dc0) * dc0) ** 0.5, t0 = 2 * dc0;
                for (let i = 1, [dc, ds, t, c, s] = [dc0, ds0, t0, c0, s0]; i < n8; i++)
                    this[i] = s += ds, ds -= t * s, this[n4 - i] = c -= dc, dc += t * c;
                if (n8 !== 0)
                    this[n8] = 0.5 ** 0.5;
                for (let j = 0; j < n4; j++)
                    this[n2 - j] = this[j];
                for (let k = 0; k < n2p4; k++)
                    this[n2 + k] = -this[k];
            }
        }
        cisTables.CISTable = CISTable;
        const tables = new Map();
        cisTables.get = (size) => (!tables.has(size) && tables.set(size, new CISTable(size)), tables.get(size));
    })(cisTables || (cisTables = {}));
    cisTables = Object.assign(cisTables.get, cisTables);
    const compare = (a, b, keys) => (typeof a === typeof b && (!a || keys.every((key) => a[key] === b[key])));
    const defaultIteration = { start: 0, offset: 0, size: 0, step: 1 };
    const iterationKeys = Object.keys(defaultIteration);
    let iterate;
    (function (iterate_1) {
        function* generator(size = 0, start = 0, offset = 0, step = 1, iterations) {
            const yields = !iterations, nextSize = size >> 1, nextStep = step << 1, nextStart = start + nextSize, nextOffset = offset + step;
            iterations = iterations || [];
            (size > 1) && (generator(nextSize, start, offset, nextStep, iterations).next(),
                generator(nextSize, nextStart, nextOffset, nextStep, iterations).next());
            (size >= 1) && (iterations.push([size, start, offset]),
                (yields) && (yield* iterations));
        }
        iterate_1.generator = generator;
        const iterators = new Map();
        function generate(size = 0, start = 0, offset = 0, step = 1) {
            let iterations;
            if (!start && !offset && step === 1) {
                if (iterators.has(size))
                    return iterators.get(size);
                const started = now();
                generator(size, start, offset, step, iterations = []).next();
                const ended = now(), elapsed = ended - started;
                debugging && setTimeout(() => console.info(`FFT: ▷ ${(size ** 0.5).toFixed(0)}² × ${iterations.length} ops / ${(elapsed).toFixed(1)}ms`), 0);
                iterators.set(size, iterations);
            }
            else {
                iterations = Array.from(generator(size, start, offset, step));
            }
            return iterations;
        }
        iterate_1.generate = generate;
        function iterate({ start = 0, offset = 0, size = 0, step = 1, remaining = true, completed = 0 }, callback) {
            const iterations = (!start && !offset && step === 1 && iterators.get(size)) || generate(size);
            let i;
            const length = iterations.length, started = now();
            for (i = 0; i < length && callback(...iterations[i]) !== false; i++)
                ;
            const ended = now(), elapsed = ended - started, operations = i, aborted = i < length - 1;
            debugging && setTimeout(() => console[aborted ? 'warn' : 'info'](`FFT: ▶︎ ${(size ** 0.5).toFixed(0)}² × ${(operations / 1000).toFixed(1)}k ops / ${(elapsed).toFixed(1)}ms`), 0);
            return iterations;
        }
        iterate_1.iterate = iterate;
    })(iterate || (iterate = {}));
    iterate = Object.assign(iterate.iterate, iterate);
    const operations = {};
    function transform($in, $out, direction, operation = { aborted: false }) {
        const forward = direction === 'forward', sign = forward ? 1 : -1, PIt = PI2;
        const validData = ($in && $in.length > 0) && ($out && $out.length > 0);
        const fromReal = validData && $in.length === $out.length / 2, fromComplex = validData && $in.length === $out.length;
        const size = fromReal ? $in.length : fromComplex ? $in.length / 2 : 0;
        const cis = cisTables(size), [n, n2, n4, n8] = cis.n;
        if (!size || !(validData && (fromReal || fromComplex)))
            return false;
        const integrate = (size, start, offset) => {
            const length = size / 2, end = start + length, d = n / size;
            for (let k = start, h = 0, k1, k2, r1, i1, r2, i2, rt, it, rk, ik; (k1 = imul(k, 2), k2 = imul(k + length, 2),
                r1 = $out[k1], i1 = $out[k1 + 1],
                r2 = $out[k2], i2 = $out[k2 + 1],
                rt = cis[h + n4], it = sign * cis[h],
                rk = (r2 || i2) && r2 * rt + i2 * it, ik = (r2 || i2) && -r2 * it + i2 * rt), k < end; k++ , h += d)
                $out[k1] += rk, $out[k1 + 1] += ik, $out[k2] = r1 - rk, $out[k2 + 1] = i1 - ik;
            return true;
        };
        const translate = fromReal ? (start, offset) => ($out[start * 2] = $in[offset] || 0, $out[start * 2 + 1] = 0, true)
            : fromComplex ? (start, offset) => ($out[start * 2] = $in[offset * 2] || 0, $out[start * 2 + 1] = $in[offset * 2 + 1] || 0, true)
                : (start, offset) => false;
        const aggregate = (size, start, offset) => !operation.aborted && (size === 1 ? translate(start, offset) : size > 1 ? integrate(size, start, offset) : false);
        return iterate({ size }, aggregate), true;
    }
    FFT.transform = transform;
    self.onmessage = (event) => {
        let { data = {}, data: { action, input, output, buffer, uid } } = event;
        if (action && /^(f|forward|i|inverse)$/.test(action)) {
            const inverse = action.startsWith('i');
            action = inverse ? 'inverse' : 'forward';
            if (!output)
                output = inverse ? new Float32Array(new SharedArrayBuffer(input.length * 4)) : new Float32Array(new SharedArrayBuffer(input.length * 4 * 2));
            if (action === 'forward')
                for (const _uid in operations)
                    operations[_uid].aborted = true;
            const operation = { uid, aborted: false };
            operations[uid] = operation;
            const done = transform(input, output, action, operation);
            delete operations[uid];
            const reply = { uid, input, output, done };
            self.postMessage(reply, FFT.transferables(input.buffer, output.buffer));
        }
        else if (action === 'preGenerate') {
            if (data.size > 0)
                iterate.generate(data.size);
        }
        else if (action === 'abort') {
            if (uid in operations)
                operations[uid].aborted = true, delete operations[uid];
        }
        else {
            console.error(`Unsupported operation`, event);
        }
    };
})(FFT || (FFT = {}));
