this.data = {
    layerIndices: {},
    imageData: {},
};
onmessage = async (e) => {
    function gcd(a, b) {
        if (b == 0) return a;
        else return gcd(b, a % b);
    }

    const header = e.data.header;
    const workerId = e.data.workerId;
    const maxLayerIdx = e.data.maxLayerIdx;
    const layerBuffer = e.data.layerBuffer;

    const layerData = layerBuffer ? new Int32Array(layerBuffer) : null;
    const imageData =
        this.data.imageData[workerId] ??
        new ImageData(header.width, header.height);
    const aspectW = header.width / gcd(header.width, header.height);
    const aspectH = header.height / gcd(header.width, header.height);

    let currLayerIdx = this.data.layerIndices[workerId] ?? -1;
    if (currLayerIdx < 0) {
        const unpackedColor =
            ((header.avgPixel & 0x7f000000) << 1) |
            (header.avgPixel & 0x00ffffff);
        for (let y = 0; y < header.height; y++) {
            for (let x = 0; x < header.width; x++) {
                for (let ch = 0; ch < 4; ch++) {
                    imageData.data[(y * header.width + x) * 4 + ch] =
                        (unpackedColor >> (ch * 8)) & 0xff;
                }
            }
        }
    }

    function decodeInner(currOffset, layerIdx, x0, y0, width, height) {
        const layerFactorW =
            layerIdx < 0
                ? aspectW
                : header.layers[header.layers.length - (layerIdx + 1)];
        const layerFactorH =
            layerIdx < 0
                ? aspectH
                : header.layers[header.layers.length - (layerIdx + 1)];

        for (let i = 0; i < layerFactorW; i++) {
            for (let j = 0; j < layerFactorH; j++) {
                let value = layerData[currOffset++];
                if (
                    layerIdx < currLayerIdx &&
                    (value > 0 || value == -2147483648)
                ) {
                    const offset = value == -2147483648 ? 0 : value >> 2;
                    decodeInner(
                        currOffset + offset,
                        layerIdx + 1,
                        x0 + (width * i) / layerFactorW,
                        y0 + (height * j) / layerFactorH,
                        width / layerFactorW,
                        height / layerFactorH,
                    );
                    currOffset++;
                } else if (layerIdx == currLayerIdx) {
                    if (value > 0 || value == -2147483648) {
                        value = layerData[currOffset++];
                    } else if (value < 0 && value != -2147483648) {
                        value = -value;
                    }

                    const unpackedColor =
                        ((value & 0x7f000000) << 1) | (value & 0x00ffffff);
                    for (
                        let y = y0 + (height * j) / layerFactorH;
                        y < y0 + (height * (j + 1)) / layerFactorH;
                        y++
                    ) {
                        for (
                            let x = x0 + (width * i) / layerFactorW;
                            x < x0 + (width * (i + 1)) / layerFactorW;
                            x++
                        ) {
                            for (let ch = 0; ch < 4; ch++) {
                                imageData.data[
                                    (y * imageData.width + x) * 4 + ch
                                ] +=
                                    ((((unpackedColor >> (ch * 8)) & 0xff) <<
                                        24) >>
                                        24) *
                                    2;
                            }
                        }
                    }
                }
            }
        }
    }

    for (; currLayerIdx <= maxLayerIdx; currLayerIdx++) {
        const imageBitmap = await createImageBitmap(imageData);
        postMessage({ workerId, currLayerIdx, imageBitmap }, [imageBitmap]);
        if (layerData) {
            decodeInner(0, -1, 0, 0, header.width, header.height);
        }
    }

    this.data.layerIndices[workerId] = currLayerIdx;
    this.data.imageData[workerId] ??= imageData;
};
