(function () {
    const construct = (tagName, properties, { parent, element } = {}) => (
        properties && (parent = properties.parent) && delete properties.parent,
        element = document.createElement(tagName),
        typeof properties === 'object' && Object.keys(properties).forEach(key => element[key] = properties[key]),
        parent && parent.appendChild(element),
        element
    );

    /* Styles */
    // "animation-delay: 0s; animation-direction: normal; animation-duration: 0s; animation-fill-mode: none; animation-iteration-count: 1; animation-name: none; animation-play-state: running; animation-timing-function: ease; background-attachment: scroll; background-blend-mode: normal; background-clip: border-box; background-color: rgba(0, 0, 0, 0); background-image: none; background-origin: padding-box; background-position: 0% 0%; background-repeat: repeat; background-size: auto; border-bottom-color: rgb(33, 33, 33); border-bottom-left-radius: 0px; border-bottom-right-radius: 0px; border-bottom-style: none; border-bottom-width: 0px; border-collapse: separate; border-image-outset: 0px; border-image-repeat: stretch; border-image-slice: 100%; border-image-source: none; border-image-width: 1; border-left-color: rgb(33, 33, 33); border-left-style: none; border-left-width: 0px; border-right-color: rgb(33, 33, 33); border-right-style: none; border-right-width: 0px; border-top-color: rgb(33, 33, 33); border-top-left-radius: 0px; border-top-right-radius: 0px; border-top-style: none; border-top-width: 0px; bottom: 0px; box-shadow: none; box-sizing: content-box; break-after: auto; break-before: auto; break-inside: auto; caption-side: top; clear: none; clip: auto; color: rgb(33, 33, 33); content: ; cursor: auto; direction: ltr; display: block; empty-cells: show; float: none; font-family: Roboto, Noto, sans-serif; font-kerning: auto; font-size: 16px; font-size-adjust: none; font-stretch: normal; font-style: normal; font-variant: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-variant-numeric: normal; font-weight: normal; height: 24px; image-rendering: auto; isolation: auto; justify-items: normal; justify-self: normal; left: 0px; letter-spacing: normal; line-height: 24px; line-height-step: 0px; list-style-image: none; list-style-position: outside; list-style-type: disc; margin-bottom: 0px; margin-left: 0px; margin-right: 0px; margin-top: 0px; max-height: none; max-width: none; min-height: auto; min-width: auto; mix-blend-mode: normal; object-fit: fill; object-position: 50% 50%; offset-anchor: auto; offset-distance: 0px; offset-path: none; offset-position: auto; offset-rotate: auto 0deg; offset-rotation: auto 0deg; opacity: 1; orphans: 2; outline-color: rgb(33, 33, 33); outline-offset: 0px; outline-style: none; outline-width: 0px; overflow-anchor: auto; overflow-wrap: normal; overflow-x: visible; overflow-y: visible; padding-bottom: 0px; padding-left: 8px; padding-right: 0px; padding-top: 0px; pointer-events: none; position: relative; resize: none; right: 0px; scroll-behavior: auto; speak: normal; table-layout: auto; tab-size: 8; text-align: start; text-align-last: auto; text-decoration: none solid rgb(33, 33, 33); text-decoration-line: none; text-decoration-style: solid; text-decoration-color: rgb(33, 33, 33); text-decoration-skip: objects; text-justify: auto; text-underline-position: auto; text-indent: 0px; text-rendering: auto; text-shadow: none; text-size-adjust: auto; text-overflow: clip; text-transform: none; top: 0px; touch-action: auto; transition-delay: 0s; transition-duration: 0s; transition-property: all; transition-timing-function: ease; unicode-bidi: normal; vertical-align: middle; visibility: visible; white-space: normal; widows: 2; width: 76.4844px; will-change: auto; word-break: normal; word-spacing: 0px; word-wrap: normal; z-index: auto; zoom: 1; -webkit-appearance: none; backface-visibility: visible; -webkit-background-clip: border-box; -webkit-background-origin: padding-box; -webkit-border-horizontal-spacing: 0px; -webkit-border-image: none; -webkit-border-vertical-spacing: 0px; -webkit-box-align: stretch; -webkit-box-decoration-break: slice; -webkit-box-direction: normal; -webkit-box-flex: 0; -webkit-box-flex-group: 1; -webkit-box-lines: single; -webkit-box-ordinal-group: 1; -webkit-box-orient: horizontal; -webkit-box-pack: start; -webkit-box-reflect: none; column-count: auto; column-gap: normal; column-rule-color: rgb(33, 33, 33); column-rule-style: none; column-rule-width: 0px; column-span: none; column-width: auto; backdrop-filter: none; align-content: normal; align-items: normal; align-self: center; flex-basis: auto; flex-grow: 0; flex-shrink: 1; flex-direction: row; flex-wrap: nowrap; justify-content: normal; -webkit-font-smoothing: antialiased; grid-auto-columns: auto; grid-auto-flow: row; grid-auto-rows: auto; grid-column-end: auto; grid-column-start: auto; grid-template-areas: none; grid-template-columns: none; grid-template-rows: none; grid-row-end: auto; grid-row-start: auto; grid-column-gap: 0px; grid-row-gap: 0px; -webkit-highlight: none; hyphens: manual; -webkit-hyphenate-character: auto; -webkit-line-break: auto; -webkit-line-clamp: none; -webkit-locale: "en"; -webkit-margin-before-collapse: collapse; -webkit-margin-after-collapse: collapse; -webkit-mask-box-image: none; -webkit-mask-box-image-outset: 0px; -webkit-mask-box-image-repeat: stretch; -webkit-mask-box-image-slice: 0 fill; -webkit-mask-box-image-source: none; -webkit-mask-box-image-width: auto; -webkit-mask-clip: border-box; -webkit-mask-composite: source-over; -webkit-mask-image: none; -webkit-mask-origin: border-box; -webkit-mask-position: 0% 0%; -webkit-mask-repeat: repeat; -webkit-mask-size: auto; order: 0; perspective: none; perspective-origin: 42.2344px 12px; -webkit-print-color-adjust: economy; -webkit-rtl-ordering: logical; shape-outside: none; shape-image-threshold: 0; shape-margin: 0px; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.4); -webkit-text-combine: none; -webkit-text-decorations-in-effect: none; -webkit-text-emphasis-color: rgb(33, 33, 33); -webkit-text-emphasis-position: over; -webkit-text-emphasis-style: none; -webkit-text-fill-color: rgb(33, 33, 33); -webkit-text-orientation: vertical-right; -webkit-text-security: none; -webkit-text-stroke-color: rgb(33, 33, 33); -webkit-text-stroke-width: 0px; transform: none; transform-origin: 42.2344px 12px; transform-style: flat; -webkit-user-drag: auto; -webkit-user-modify: read-only; user-select: none; -webkit-writing-mode: horizontal-tb; -webkit-app-region: no-drag; buffered-rendering: auto; clip-path: none; clip-rule: nonzero; mask: none; filter: none; flood-color: rgb(0, 0, 0); flood-opacity: 1; lighting-color: rgb(255, 255, 255); stop-color: rgb(0, 0, 0); stop-opacity: 1; color-interpolation: sRGB; color-interpolation-filters: linearRGB; color-rendering: auto; fill: rgb(0, 0, 0); fill-opacity: 1; fill-rule: nonzero; marker-end: none; marker-mid: none; marker-start: none; mask-type: luminance; mask-source-type: alpha; shape-rendering: auto; stroke: none; stroke-dasharray: none; stroke-dashoffset: 0px; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 4; stroke-opacity: 1; stroke-width: 1px; alignment-baseline: auto; baseline-shift: 0px; dominant-baseline: auto; text-anchor: start; writing-mode: horizontal-tb; vector-effect: none; paint-order: fill stroke markers; d: none; cx: 0px; cy: 0px; x: 0px; y: 0px; r: 0px; rx: auto; ry: auto; translate: none; rotate: none; scale: none; caret-color: rgb(33, 33, 33);"
    // @import url('https://fonts.googleapis.com/css?family=Roboto+Mono:400,700|Roboto:400,300,300italic,400italic,500,500italic,700,700italic');
    const styles = `
        * { align-items: center; justify-content: center; flex: 0 1 auto; min-width: 0; min-height: 0; /* transition: all 250ms ease-in-out; */ }
        html, body { min-height: 100vh; max-width: 100vw; }
        body {
            display: flex; align-items: center; justify-content: center; flex-flow: row nowrap;
            background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" style="opacity: 0.125;">         <rect x="50" y="0" width="50" height="50" fill="black" />         <rect x="0" y="50" width="50" height="50" fill="black" />         <rect x="0" y="0" width="50" height="50" fill="white" />         <rect x="50" y="50" width="50" height="50" fill="white" />     </svg>');
            font-family: Roboto, Noto, sans-serif; font-size: 12px;
        }

        * {
            -webkit-user-select: none; user-select: none;
            margin: auto;
        }

        sample table, sample tr, sample td, sample td img {
            display: flex; flex-wrap: nowrap; flex: 0 1 auto;
            max-width: 100%; max-height: 100%;
            /* height:100%; */
        }

        sample table, sample tr, sample td {
            /* width: fit-content; height: fit-content; */
        }

        sample td > img {
            width: auto; height: auto;
            max-width: 100%; max-height: 100%;
        }

        sample td:not([colspan]) > img {
            max-width: 100.5%; max-height: 100.5%; width: 333.33px;
        }

        sample { max-width: 100%; min-height: min-content; }

        sample table {
            border-collapse: collapse;
            background-position: center;
            background-repeat: no-repeat;
            background-size: contain;
        }
        sample table, sample td { flex-direction: column; }
        sample tr { flex-direction: row; border: 0 none !important; }

        sample td {
            overflow: hidden; background-color: rgba(255, 255, 255, 0.5);
        }

        [not-draggable] {
            pointer-events: none;
        }
        sample td:not([not-draggable]):hover, sample td.dragged {
            overflow: visible; background-color: transparent;
        }
        sample td:not([not-draggable]):hover::after {
            position: absolute; width: 100%; height: 100%;
            box-shadow: 0 0 10px rgba(255, 127, 63, 0.75), 0 0 10px rgba(255, 255, 255, 1);
        }

        /* sample td.dragged::after {
            position: absolute; width: 100%; height: 100%;
            box-shadow: 0 0 2.5px rgba(255, 127, 63, 0.75), 0 0 2.5px rgba(255, 255, 255, 1);
        } */

        sample td > img {
            object-fit: cover; opacity: 0.75; z-index: 0;
        }
        sample td > img:hover {
            opacity: 1; z-index: 1; border-radius: 0.25em;
            box-shadow: 0 0 20px 5px rgba(255, 255, 255, 0.75), 0 0 30px 10px rgba(255, 191, 127, 1);
        }

        sample td.dragged > img, sample td > img.dragged {
            opacity: 1; z-index: 1;
            box-shadow: 0 0 0.25rem rgba(255, 255, 255, 0.75), 0 0 0.25rem rgba(255, 191, 127, 1);
        }

        img[hidden] { pointer-events: none; opacity: 0.5; object-fit: contain; max-width: 100%; max-height: 100%; }
        /* img[src$='.svg'] { flex: 0 1 auto; width: 333.33px; } */

        #banner {
            display: flex; align-items: center; justify-content: center;
            position: fixed; top: 0; left: 0; right: 0; max-width: 100%; height: 20px;
            color: white; background-color: rgba(63, 127, 255, 0.75);
            font-size: 12px; text-align: center;
        }
        sample {
            position: relative; top: 20px; /* max-width: 100vw; */
        }
    `;

    const styleElement = construct('style'); // Object.assign(document.createElement('style'), { id: 'conres-samples-style', textContent: styles });
    styleElement.id = 'conres-samples-styles'; styleElement.textContent = styles;
    document.head.appendChild(styleElement);

    /* Banner */
    const bannerElement = construct('div', { id: 'banner', textContent: document.title }); // , { parent: document.body });
    document.body.appendChild(bannerElement);

    /* Draggify */
    // if ((navigator.appVersion.match(/(Chrome|Safari)/g) || '').length !== 1) {
    const images = document.querySelectorAll('img'); // document.images; // draggify = (image) => image.setAttribute('draggable', '');
    for (const image of images) { // (({naturalHeight: h = 0, naturalWidth: w = 0, s = h * w} = {})=>(s > 0 && draggify(image)))(image);
        const { naturalHeight: h = 0, naturalWidth: w = 0 } = image;
        const contrast = image.getAttribute('contrast'), resolution = image.getAttribute('resolution') || (image.closest('tr') && image.closest('tr').getAttribute('resolution'));
        if (contrast) image.setAttribute('contrast', contrast);
        if (resolution) image.setAttribute('resolution', resolution);
        !image.closest('not-draggable') && h && w && h * w ? image.setAttribute('draggable', '') : image.removeAttribute('draggable');
    }

    /* Dragging */
    const appendQuery = (uri, query = {}, url = new URL(uri)) => (/^data:/).test(uri)
        ? uri.replace(/(data.*?;)/, `$1${Object.keys(query).reduce((attributes, key) => query[key] ? [...attributes, `${key}=${query[key]}`] : attributes, []).join(';')};`)
        : (Object.keys(query).map(key => url.searchParams.append(key, query[key])), url.href);
    const context = (target = new Image(), contrast = target.getAttribute('contrast'), resolution = target.getAttribute('resolution') || (target.closest('tr') && target.closest('tr').getAttribute('resolution')), url = appendQuery(target.src, { contrast, resolution })) => target ? { // && target instanceof HTMLImageElement
        contrast, resolution, // contrast: target.getAttribute('contrast'), resolution: target.getAttribute('resolution') || (target.closest('tr') && target.closest('tr').getAttribute('resolution')),
        // image: target, url: contrast || resolution ? appendQuery(target.src, { contrast, resolution }) : target.src, html: `<meta http-equiv="Content-Type" content="text/html;charset=UTF-8"><img src="${target.src}" />`,
        image: target, url, html: `<meta http-equiv="Content-Type" content="text/html;charset=UTF-8"><img src="${url}" />`,
    } : {};

    document.addEventListener('dragstart', (event, ) => {
        const { dataTransfer, target } = event || {};
        if (event && dataTransfer) { // } && target.src) {
            let { image, url, html, contrast, resolution } = context(target);
            if (image || url || html) {
                for (const dragged of document.querySelectorAll('.dragged')) dragged.classList.remove('dragged');
                target.classList.add('dragged');
                target.parentElement && target.parentElement.classList.add('dragged');
                // if (contrast || resolution) {
                //     const uri = new URL(url);
                //     contrast & uri.searchParams.append('contrast', contrast);
                //     resolution & uri.searchParams.append('resolution', resolution);
                //     url = uri.href;
                //     html = `<meta http-equiv="Content-Type" content="text/html;charset=UTF-8"><img src="${url}" />`
                // }
                dataTransfer.setDragImage(image, 0, 0);
                dataTransfer.setData('text/html', html);
                dataTransfer.setData('text/plain', url);
                // dataTransfer.setData('public.utf8-plain-text', src);
            }
        }
    });
    // }

    requestAnimationFrame(() => document.querySelectorAll('sample').forEach(sample => {
        sample.style.display = 'flex';
        sample.removeAttribute('hidden');
    }));

    /* Convert */
    // let samples = document.querySelectorAll('sample');
    // for (const sample of samples) {
    //     const images = sample.querySelectorAll('img');
    //     for (const image of images) {
    //         const { parentElement, src } = image;
    //         if (src && parentElement && parentElement.children.length === 1) {
    //             parentElement.style.backgroundImage = `url(${src})`;
    //             parentElement.classList.add('slice-image');
    //         }
    //     }
    // }
    function convertSample(container) {
        let sample = container && container.querySelector('sample');
        let table = sample && sample.querySelector('table');
        const canvas = document.createElement('canvas');
        if (!sample || !table) return;

        // Sample
        let _sample = create('sample');
        _sample.setAttribute('hidden', '');

        // Table
        let _table = create('table'); _sample.appendChild(_table);
        _table.setAttribute('border', 0), _table.setAttribute('cellpadding', 0), _table.setAttribute('cellspacing', 0);

        let rows = table && table.querySelectorAll('tr');
        for (const row of rows) {

            // Row
            const _row = create('tr'); _table.appendChild(_row);
            let resolution = row.getAttribute('resolution');

            const columns = row && row.querySelectorAll('td');
            for (const column of columns) {
                resolution = resolution || column.getAttribute('resolution')

                // Column
                const _column = create('td'); _row.appendChild(_column);
                let contrast = _column.getAttribute('contrast');

                const image = _column.querySelector('img');
                const { src, naturalWidth, naturalHeight } = image;

                if (image) {
                    // Patch
                    const _image = image.cloneNode(true);

                    contrast = contrast || image.getAttribute('contrast');
                    resolution = resolution || column.getAttribute('resolution')
                }

                _column.innerHTML = column.innerHTML;
            }

            if (resolution) _row.setAttribute(resolution);
        }
    }; // (document.body);
})();
