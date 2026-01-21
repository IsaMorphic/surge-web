ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) return
            yield value
        }
    }
    finally {
        reader.releaseLock()
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function concat(views) {
    let length = 0
    for (const v of views)
        length += v.byteLength

    let buf = new Uint8Array(length)
    let offset = 0
    for (const v of views) {
        const uint8view = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
        buf.set(uint8view, offset)
        offset += uint8view.byteLength
    }

    return buf
}

const surgePlugin = { invocCount: 0, maxWorkers: 1, workers: [] };

surgePlugin.getWorker = function () {
    if (!this.workers[this.invocCount % this.maxWorkers]) {
        const worker = new Worker('/plugins/surge/surge-worker.js');
        this.workers.push(worker);
        return worker;
    } else {
        return this.workers[this.invocCount++ % this.maxWorkers];
    }
}

surgePlugin.parse = async function* (url) {
    function gcd(a, b) {
        if (b == 0)
            return a;
        else
            return gcd(b, a % b);
    }

    function* factors(number) {
        for (let div = 2; div <= Math.sqrt(number); div++) {
            while (number % div == 0) {
                yield div;
                number = number / div;
            }
        }
        if (number > 1) yield number;
    }

    const response = await fetch(url, { headers: { "Accept": "application/x-cfs-surge" } });
    if (response.headers.get("Content-Type") != "application/x-cfs-surge") return;

    const reader = response.body.getReader();

    let leftover = (await reader.read()).value;

    const ints = new Int32Array(leftover.buffer, 0, 4);
    const commonFactor = gcd(ints[1], ints[2]);
    header = {
        magic: ints[0],
        width: ints[1],
        height: ints[2],
        avgPixel: ints[3],
        layers: Array.from(factors(commonFactor)),
    };

    const segmentSizes = [...new Uint32Array(leftover.buffer, 16, header.layers.length + 1)];
    header.segmentSizes = [...segmentSizes];

    yield header;

    leftover = new Uint8Array(leftover.buffer, 16 + header.layers.length * 4 + 4);
    const segmentedStream = new ReadableStream({
        async pull(controller) {
            let fulfilledChunkQuota = false;

            let chunkSize = segmentSizes.shift();
            while (!fulfilledChunkQuota) {
                const status = await reader.read();

                if (!status.done) {
                    const chunk = status.value;
                    leftover = concat([leftover, chunk]);
                }

                if (leftover.byteLength >= chunkSize) {
                    const chunkToSend = leftover.slice(0, chunkSize);
                    controller.enqueue(chunkToSend);

                    leftover = new Uint8Array(leftover.buffer, leftover.byteOffset + chunkSize);
                    fulfilledChunkQuota = true;
                }
                else if (status.done) {
                    fulfilledChunkQuota = true;
                    controller.close();
                }
            }
        },
    });

    for await (const segment of segmentedStream) {
        yield new Int32Array(segment.buffer, segment.byteOffset);
    }
}

surgePlugin.decode = function (worker, workerId, imageData, layers, layerBuffer, maxLayerIdx) {
    return new Promise((resolve, reject) => {
        worker.addEventListener("message", e => {
            if (e.data.workerId == workerId) {
                resolve(e.data.imageData);
            }
        });

        worker.postMessage(
            { workerId, imageData, layers, layerBuffer, maxLayerIdx }
        );
    });
}

surgePlugin.main = async function (surgeElement) {
    let canvasElem;
    let canvasCtx;

    let ssrgHeader;
    let canvasImageData;

    let layerBuffer = null;
    let layerNum = -1;

    const altText = surgeElement.getAttribute('alt');
    const srcUrl = surgeElement.getAttribute('src');
    const workerId = srcUrl + "-" + Date.now();
    const worker = this.getWorker();
    for await (const chunk of this.parse(srcUrl)) {
        if (chunk instanceof Int32Array) {
            layerBuffer = layerBuffer == null ? chunk : new Int32Array(concat([layerBuffer, chunk]).buffer);
            canvasImageData = await this.decode(worker, workerId, layerNum > 0 ? null : canvasImageData, ssrgHeader.layers, layerBuffer, layerNum++);
            canvasCtx.putImageData(canvasImageData, 0, 0);
        } else {
            ssrgHeader = chunk;

            canvasElem = document.createElement('canvas');
            canvasCtx = canvasElem.getContext('2d');

            canvasElem.id = surgeElement.id;
            canvasElem.classList = surgeElement.classList;

            const altTextElem = document.createElement('p');
            altTextElem.innerText = altText;
            canvasElem.appendChild(altTextElem);

            canvasElem.width = ssrgHeader.width;
            canvasElem.height = ssrgHeader.height;

            surgeElement.parentElement.appendChild(canvasElem);
            surgeElement.remove();

            canvasImageData = canvasCtx.getImageData(0, 0, ssrgHeader.width, ssrgHeader.height);

            const unpackedColor = ((ssrgHeader.avgPixel & 0x7F000000) << 1) | (ssrgHeader.avgPixel & 0x00FFFFFF);
            for (let y = 0; y < ssrgHeader.height; y++) {
                for (let x = 0; x < ssrgHeader.width; x++) {
                    for (let ch = 0; ch < 4; ch++) {
                        canvasImageData.data[(y * ssrgHeader.width + x) * 4 + ch] = (unpackedColor >> (ch * 8)) & 0xFF;
                    }
                }
            }
        }
    }
}

new MutationObserver(mutations => mutations.forEach(mutation => mutation.addedNodes.forEach(el => {
    if (el instanceof HTMLImageElement)
        el.onerror = () => surgePlugin.main(el);
}))).observe(document.documentElement, { subtree: true, childList: true });