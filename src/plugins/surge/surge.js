ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
        }
    } finally {
        reader.releaseLock();
    }
};

function concat(views) {
    let length = 0;
    for (const v of views) length += v.byteLength;

    let buf = new Uint8Array(length);
    let offset = 0;
    for (const v of views) {
        const uint8view = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        buf.set(uint8view, offset);
        offset += uint8view.byteLength;
    }

    return buf;
}

const surgePlugin = { invocCount: 0, maxWorkers: 4, workers: [] };

surgePlugin.getWorker = function () {
    if (!this.workers[this.invocCount % this.maxWorkers]) {
        const worker = new Worker("/plugins/surge/surge-worker.js");
        this.workers.push(worker);
        ++this.invocCount;
        return worker;
    } else {
        return this.workers[this.invocCount++ % this.maxWorkers];
    }
};

surgePlugin.parse = async function* (url) {
    function gcd(a, b) {
        if (b == 0) return a;
        else return gcd(b, a % b);
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

    const response = await fetch(url, {
        headers: { Accept: "application/x-cfs-surge" },
    });
    if (response.headers.get("Content-Type") != "application/x-cfs-surge")
        return;

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

    const segmentSizes = [
        ...new Uint32Array(leftover.buffer, 16, header.layers.length + 1),
    ];
    header.segmentSizes = [...segmentSizes];

    yield header;

    leftover = new Uint8Array(
        leftover.buffer,
        16 + header.layers.length * 4 + 4,
    );
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

                    leftover = new Uint8Array(
                        leftover.buffer,
                        leftover.byteOffset + chunkSize,
                    );
                    fulfilledChunkQuota = true;
                } else if (status.done) {
                    fulfilledChunkQuota = true;
                    controller.close();
                }
            }
        },
    });

    for await (const segment of segmentedStream) {
        yield new Uint8Array(segment.buffer, segment.byteOffset);
    }
};

surgePlugin.decode = function (
    header,
    worker,
    workerId,
    maxLayerIdx,
    layerBuffer,
) {
    return new Promise((resolve, reject) => {
        worker.addEventListener("message", (e) => {
            if (
                e.data.workerId == workerId &&
                e.data.currLayerIdx == maxLayerIdx
            ) {
                resolve(e.data.imageBitmap);
            }
        });

        worker.postMessage(
            {
                header,
                workerId,
                maxLayerIdx,
                layerBuffer,
            },
            layerBuffer ? [layerBuffer] : [],
        );
    });
};

surgePlugin.main = async function (surgeElement) {
    let header;
    let canvasElem, canvasCtx;

    const altText = surgeElement.getAttribute("alt");
    const classList = surgeElement.classList ?? [];
    const elemId = surgeElement.getAttribute("id");
    const srcUrl = surgeElement.getAttribute("src");

    let layerNum = -1;
    const layers = [];
    const workerId = srcUrl + "-" + Date.now();
    const worker = this.getWorker();

    async function flushNext(options) {
        const layerBuffer = options.shouldDecode ? concat(layers).buffer : null;
        const canvasImageBitmap = await surgePlugin.decode(
            header,
            worker,
            workerId,
            layerNum++,
            layerBuffer,
        );
        canvasCtx.clearRect(
            0,
            0,
            canvasImageBitmap.width,
            canvasImageBitmap.height,
        );
        canvasCtx.drawImage(canvasImageBitmap, 0, 0);
        canvasImageBitmap.close();
    }

    for await (const chunk of this.parse(srcUrl)) {
        if (chunk instanceof Uint8Array) {
            layers.push(chunk);
            await flushNext({ shouldDecode: true });
        } else {
            header = chunk;

            canvasElem = document.createElement("canvas");
            canvasCtx = canvasElem.getContext("2d");

            if (elemId) {
                canvasElem.setAttribute("id", elemId);
            }

            if (altText) {
                canvasElem.setAttribute("role", "img");
                canvasElem.setAttribute("aria-label", altText);

                const altTextElem = document.createElement("p");
                altTextElem.innerText = altText;
                canvasElem.appendChild(altTextElem);
            }

            if (classList.length > 0) {
                canvasElem.classList = classList;
            }

            canvasElem.width = header.width;
            canvasElem.height = header.height;

            surgeElement.parentElement.appendChild(canvasElem);
            surgeElement.remove();
        }
    }
    await flushNext({ shouldDecode: false });
};

new MutationObserver((mutations) =>
    mutations.forEach((mutation) =>
        mutation.addedNodes.forEach((el) => {
            if (el instanceof HTMLImageElement)
                el.onerror = () => surgePlugin.main(el);
        }),
    ),
).observe(document.documentElement, { subtree: true, childList: true });
