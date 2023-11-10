onmessage = e => {
    function gcd(a, b) {
        if (b == 0)
            return a;
        else
            return gcd(b, a % b);
    }

    const imageData = e.data.imageData;
    const imageDataView = new Uint32Array(imageData.data.buffer);
    const layers = e.data.layers;
    const layerBuffer = e.data.layerBuffer;
    const maxLayerIdx = e.data.maxLayerIdx;
    const aspectW = imageData.width / gcd(imageData.width, imageData.height);
    const aspectH = imageData.height / gcd(imageData.width, imageData.height);

    function decodeInner(currOffset, layerIdx, x0, y0, width, height) {
        const layerFactorW = layerIdx < 0 ? aspectW : layers[layers.length - (layerIdx + 1)];
        const layerFactorH = layerIdx < 0 ? aspectH : layers[layers.length - (layerIdx + 1)];

        for (let i = 0; i < layerFactorW; i++) {
            for (let j = 0; j < layerFactorH; j++) {
                let value = layerBuffer[currOffset++];
                if (layerIdx < maxLayerIdx && (value > 0 || value == -2147483648)) {
                    const offset = value == -2147483648 ? 0 : value >> 2;
                    decodeInner(currOffset + offset, layerIdx + 1,
                        x0 + width * i / layerFactorW,
                        y0 + height * j / layerFactorH,
                        width / layerFactorW,
                        height / layerFactorH);
                    currOffset++;
                } else if (layerIdx == maxLayerIdx) {
                    if (value > 0 || value == -2147483648) {
                        value = layerBuffer[currOffset++];
                    } else if (value < 0 && value != -2147483648) {
                        value = -value;
                    }

                    const unpackedColor = ((value & 0x7F000000) << 1) | (value & 0x00FFFFFF);
                    for (let y = y0 + height * j / layerFactorH; y < y0 + height * (j + 1) / layerFactorH; y++) {
                        for (let x = x0 + width * i / layerFactorW; x < x0 + width * (i + 1) / layerFactorW; x++) {
                            for (let ch = 0; ch < 4; ch++) {
                                imageData.data[(y * imageData.width + x) * 4 + ch] += (((unpackedColor >> (ch * 8)) & 0xFF) << 24 >> 24) * 2;
                            }
                        }
                    }
                }
            }
        }
    }

    decodeInner(0, -1, 0, 0, imageData.width, imageData.height);
    postMessage(imageData);
}