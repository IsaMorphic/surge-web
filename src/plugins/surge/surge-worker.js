this.data = {
    layerIndices: {},
    imageData: {},
};
onmessage = async (e) => {
    function gcd(a, b) {
        if (b == 0) return a;
        else return gcd(b, a % b);
    }

    const workerId = e.data.workerId;
    const layers = e.data.layers;
    const layerBuffer = new Int32Array(e.data.layerBuffer);
    const maxLayerIdx = e.data.maxLayerIdx;

    const imageData = this.data.imageData[workerId] ?? e.data.imageData;
    const aspectW = imageData.width / gcd(imageData.width, imageData.height);
    const aspectH = imageData.height / gcd(imageData.width, imageData.height);

    let currLayerIdx = this.data.layerIndices[workerId] ?? -1;
    function decodeInner(currOffset, layerIdx, x0, y0, width, height) {
        const layerFactorW =
            layerIdx < 0 ? aspectW : layers[layers.length - (layerIdx + 1)];
        const layerFactorH =
            layerIdx < 0 ? aspectH : layers[layers.length - (layerIdx + 1)];

        for (let i = 0; i < layerFactorW; i++) {
            for (let j = 0; j < layerFactorH; j++) {
                let value = layerBuffer[currOffset++];
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
                        value = layerBuffer[currOffset++];
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
        decodeInner(0, -1, 0, 0, imageData.width, imageData.height);
        const imageBitmap = await createImageBitmap(imageData);
        postMessage({ workerId, currLayerIdx, imageBitmap }, [imageBitmap]);
    }

    this.data.layerIndices[workerId] = currLayerIdx;
    this.data.imageData[workerId] ??= imageData;
};
