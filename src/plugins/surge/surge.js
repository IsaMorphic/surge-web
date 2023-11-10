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

async function* surgeParse(url) {
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

    const response = await fetch(url);
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

                    if (leftover.byteLength >= chunkSize) {
                        const chunkToSend = leftover.slice(0, chunkSize);
                        controller.enqueue(chunkToSend);

                        leftover = new Uint8Array(leftover.buffer, leftover.byteOffset + chunkSize);
                        fulfilledChunkQuota = true;
                    }
                }
                if (status.done) {
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

function surgeDecode(worker, imageData, layers, layerBuffer, maxLayerIdx) {
    return new Promise((resolve, reject) => {
        worker.onmessage = e => {
            resolve(e.data);
        }

        worker.postMessage(
            { imageData, layers, layerBuffer, maxLayerIdx }
        );
    });
}
async function surgeMain(surgeElement) {
    const scale = window.devicePixelRatio;

    const canvasElem = document.createElement('canvas');
    const canvasCtx = canvasElem.getContext('2d');

    surgeElement.parentElement.appendChild(canvasElem);

    let ssrgHeader;
    let canvasImageData;

    let layerBuffer = null;
    let layerNum = -1;


    const worker = new Worker('/plugins/surge/surge-worker.js');
    for await (const chunk of surgeParse(surgeElement.getAttribute('src'))) {
        if (chunk instanceof Int32Array) {
            layerBuffer = layerBuffer == null ? chunk : new Int32Array(concat([layerBuffer, chunk]).buffer);
            canvasImageData = await surgeDecode(worker, canvasImageData, ssrgHeader.layers, layerBuffer, layerNum++);
            canvasCtx.putImageData(canvasImageData, 0, 0);
        } else {
            ssrgHeader = chunk;

            canvasElem.classList = surgeElement.classList;

            canvasElem.width = ssrgHeader.width;
            canvasElem.height = ssrgHeader.height;

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

function surgeInstall() {
    let surgePromises = [];
    for (const surgeElement of document.getElementsByTagName('surge')) {
        surgePromises.push(surgeMain(surgeElement));
    }
    return Promise.all(surgePromises);
}

console.log(surgeInstall());