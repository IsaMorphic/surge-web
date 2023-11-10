```toml
%%%

title = "SSRG (Scalable Streaming Raster Graphics) Specification Version 1.0"
keyword = ["streaming", "image", "graphics", "web", "scalable", "multi-resolution", "raster"]
area = "Internet"
ipr="trust200902"
date = 2023-11-10T00:00:00Z

[seriesInfo]
name = "Internet-Draft"
value = "draft-santin-ssrg-00"
stream = "independent"
status = "informational"

[[author]]
initials="I. M."
surname="Santin"
fullname="Isabelle Manuela Santin"
organization = "Chosen Few Software"
  [author.address]
  email = "isabelle@chosenfewsoftware.com"
 
%%%
```

# Scalable Streaming Raster Graphics for the Web (SSRG)

## Abstract

This document describes the Scalable Streaming Raster Graphics (SSRG) specification for the modern Web. An unfortunate truth of the modern internet is that digital equity has been secondary to the expansion of broadband in the most developed areas of the world. This in turn makes it much harder for developing nations to gain a competitive foothold in the digital market due to lackluster download speeds limiting access to content-rich applications and educational resources. 

The SSRG specification, dubbed "Surge" by its creator, intends to bridge "The Digital Divide" using techniques of classical quadtree image compression and Laplacian image pyramids to create a more scalable and equitable browsing experience for low-bandwidth users while still providing standard features such as perceptually lossless image quality at competitive compression rates. The format efficiently encodes a multi-resolution version of the stored image that can be streamed sequentially in order of increasing pixel resolution using conventional mechanisms of the HTTP protocol.

The specification comes in three main parts:

1. SSRG stream format
2. Decoding algorithm
3. HTTP conventions

## Introduction

The SSRG specification, dubbed "Surge" by its creator, intends to bridge "The Digital Divide" using techniques of classical quadtree image compression and Laplacian image pyramids to create a more scalable and equitable browsing experience for low-bandwidth users while still providing standard features such as perceptually lossless image quality at competitive compression rates. The format efficiently encodes a multi-resolution version of the stored image that can be streamed sequentially in order of increasing pixel resolution using conventional mechanisms of the HTTP protocol.

Before describing the physical storage format for SSRG images, it is helpful to contextualize its various quirks within the context of the main compression algorithm. This algorithm is not a part of the specification itself, and can vary from implementation to implementation. As mentioned in the abstract of this document, the SSRG format makes use of quadtree compression techniques and Laplacian image pyramids to efficiently encode the same image sampled at multiple resolutions.

### Sampling

For the sake of demonstration, the following sections will describe a typical approach for quad-tree image compression. However, the author notes that the actual approach used to encode SSRG images is slightly more convoluted, and is respectful of a larger variety of non-square image dimensions.

To effectively estimate the source image at different resolution levels, our example implementation will center the source image within a `2^n x 2^n` pixel grid so an N-depth region quadtree can be used for decomposition. Importantly, each node of the quadtree is tagged with the value of a sampling function for the square region it represents, as well as a flag that signifies whether this node has: 

​	a. no children

​	b. all four of its possible children. 

This information is crucial to the objective of the compression algorithm, which is described next.

### Decomposition

The sampling function used in this example will be a simple mean-area function, which takes the mean color value of all the pixels in a given square region as the sample. Complementary to the sampling function is the error function, which at a high level should return some error metric `E` such that its value can be used by a threshold function to decide whether the sampled value for a given region is sufficiently representative of all its constituent pixels. This ideally means that `E = 0.0` when all of the pixels in the given region have the same color value (i.e it is totally uniform). From this we also derive that when the error threshold for the compression algorithm is zero, the quadtree decomposition data can be used to reconstruct the source image perfectly. Therefore, our example compression algorithm can be used in either lossy or lossless modes, depending on the error threshold. 

In this example, the error metric will be defined by the standard deviation of all the pixel color values in the source image for a given region. This is convenient to calculate considering we are already doing the work to calculate the mean color value. To do this efficiently, all of the pixels are embedded as unit vectors in a 4-space where the directionless vector (0, 0, 0, 0) represents 50% grey at 50% opacity. Then, to create a notion of "difference" (which is required to calculate the variance of the set), one takes the dot product of each vector with the embedded mean value. Important to note is that by using this specific spatial notion of standard deviation, the error function is conveniently placed in the continuous range of [0, 1].

### Algorithm

Given both the sampling and error functions, alongside the square framing of the source image, one can proceed with the following recursive decomposition algorithm:

1. Initialize `R` as the full square region of the aforementioned `2^n x 2^n` grid
2. Calculate the mean and error values (`M` and `E`) for region `R`
3. (a) Store the resulting mean as quadtree node `N(R)`
4. If `E` exceeds the error threshold `E_max` do the following:
   1. Flag `N(R)` as containing children
   2. Split `R` into northwest, northeast, southwest, and southeast quadrants. Assign them to `r[0..3]` respectively.
   3. (b) For each quadrant `r[k]`, calculate the mean and error values (`m[k]` and `e[k]`) and recursively call steps 3(a) thru 5, substituting `R` for `r[k]`, `M` for `m[k]`, and `E` for `e[k]`. 
5. Return to caller / halt

### Analysis

Using the above algorithm, one can immediately recognize that such a decomposition is ideal for eliminating 2-dimensional, spatial redundancies in the source image. One can increase the compression ratio even further by borrowing a page from the book of Laplacian image pyramids, which uses differential coding across increasingly "blurry" copies of the original image to achieve lower spatial entropy and sample density. The SSRG encoder does exactly this, only treating the hierarchical levels of the image tree as an alternative to the typical subsampling procedure of the technique. 

## Part A: SSRG stream format

The SSRG stream format is simple in its principles but complex in its various quirks. It was designed with a few key goals in mind, listed below:

* Minimalistic: the format should be simple to implement and require little processing overhead to decode
* Optimized: the format should make the best possible use of its allocated resources, especially in terms of storage & memory
* Portable: the format should be unambiguous in its specification and able to be implemented on the vast majority of web platforms
* Conservative: the format should be built intentionally with sufficient extra storage space for future expansion

Additionally, every SSRG stream is written in little-endian byte order, and with the following order of data chunks:

1. Header
2. Chunk #1
3. Chunk #2
4. ....
5. Chunk #N

Where each "chunk" is a successive depth iteration of a breadth-first traversal of the given image tree (which itself is obtained through a decomposition method similar to that described in the introduction). The structure of the header is described next.

### Header format

Below is a table consisting of all the fields in the header:

| Offset | Bytes 0 - 3               | Bytes 4 - 7                          |
| ------ | ------------------------- | ------------------------------------ |
| 0x00   | FourCC ASCII `SSRG`       | `uint32` Image Width                 |
| 0x08   | `uint32` Image Height     | `sint32` Mean Pixel Value (Explicit) |
| 0x10   | `uint32` Number of Chunks | `uint32` Chunk #1 Offset             |
| ...    | ...                       | ...                                  |
| ...    | `uint32` Chunk #N Offset  |                                      |

### Pixel format

In some cases, a little-endian, signed, 32-bit integer read from an SSRG stream represents a pixel value. One such case is at offset `0x0C` of the file header described above. Furthermore, pixel values can either use explicit or differential coding. Explicitly coded pixel values are interpreted literally with no extra computation, while differentially coded pixel values are expressed as a signed, per-channel distance from a known value. 

#### Explicit coding (bit-by-bit)

Physical representation: `rrrrrrrrggggggggbbbbbbbbaaaaaaaS`(MSB)

Abstract interpretation: 32-bit full color pixel value in RGBA byte-order; Two's complement representation takes one bit away from the alpha channel for sign information (described in detail under "Chunk format"). 

#### Differential coding (bit-by-bit)

Physical representation: `rrrrrrrsgggggggsbbbbbbbsaaaaaasS`(MSB)

Abstract interpretation: four signed, 8-bit integer values which are packed together in RGBA byte-order; the bytes represent a per-component signed distance between this pixel's value, and that of some other pixel which is known prior. The last byte (alpha) is treated as a 7-bit signed integer, leaving the most significant bit of the double-word to represent its own independent sign. The author notes that the absolute value of the the packed pixel must be obtained before properly decoding sign and magnitude information for each individual color channel. 

### Chunk format

Chunks consist always of a uniform series of signed 32-bit integers. Depending on the sign of a given integer in the stream, it may or may not be followed by another associated integer. Beginning with the first integer after the header, if it is positive, the next integer will also be positive and represent a relative offset value to an integer in the next chunk. If it is negative, the tentative pair is considered incomplete, and the stream pointer does not advance. Furthermore, the absolute value of this integer is used for all further processing.

The first value of a given pair should ALWAYS be treated as a differentially coded pixel value. 

The second value of a given pair, if it exists, should ALWAYS be treated as an offset value to the first child of this node. Further, its two LSBs MUST be cleared to obtain the actual offset value. The author notes that these two bits are reserved for future revisions of the SSRG stream specification. 

Readers are encouraged to read the next section and/or view the reference implementation attached to this Internet-Draft for more context and information about how one might properly decode SSRG streams [surge-web]. 

## Part B: Decoding algorithm

As was briefly discussed under "Introduction", the actual decoding algorithm used by compliant implementations differs slightly in complexity. In reality, the quad-tree based algorithm outlined earlier only functions properly for square images with dimensions equal to some power of two. Therefore, the author considers such an implementation of the SSRG format incomplete, and lacking of a key feature: *support for rectangular images of arbitrary dimensions.* 

As it turns out, this key feature can be quite easily implemented as an extension of the original quad-tree algorithm, only instead of every pixel of every "chunk" having exactly four subsamples, they may have any arbitrary number of subsamples so long as the following criteria are met:

1. The pixel in question precisely represents a square region of the original image.
2. The pixel is divisible into `n x n` spatially uniform sub-regions, where `n` is prime.

Instituting these two requirements allows one to extend the quad-tree decomposition method to work for square images of arbitrary size, as the dimensions of the original image along both axes can be factorized, and subsequently "chunked" based on each of these prime factors. However, two exceptions to these criteria are needed to adapt the algorithm to function for rectangular images of arbitrary size:

For a rectangular image `K` with an aspect ratio of `N:M`

1. The pixel representing the mean value of `K` CAN be rectangular
2. This "root" pixel (residing in Chunk #0 of the image) is divisible into `N x M` spatially uniform sub-regions, where `N` and `M` are coprime. 

Finally, having outlined these criteria, one can modify the quad-tree decomposition algorithm discussed at the beginning of this document such that the image tree can be subdivided into an arbitrary number of square regions, per axis, at each recursive step. Note well that both the aspect ratio and prime factorizations of the input image dimensions can be computed from the width and height values provided in the header alone. 

The author recognizes that the explanation provided in this part of the specification is somewhat ambiguous and lacks the type of precise clarity required to write an appropriate implementation. For this reason, she highly recommends viewing the official decoder implementation attached to this document as a reference point [surge-web]. 

## Part C: HTTP conventions

All WWW servers that plan to support the SSRG specification should properly use the following conventions in HTTP responses [RFC9113] serving requests for SSRG format images. 

### MIME Headers

The `Content-Type` header to be used when serving SSRG formatted streams should be: `application/x-cfs-surge`

### Compression format

To maintain competitive storage efficiency in comparison to other popular lossless formats on the web, SSRG files should be encoded, compressed, and stored *offline*. The author of this specification highly recommends that GZip compression is used for SSRG streams both at-rest and in-transit. This includes setting the `Content-Encoding` response header to `gzip` whenever SSRG resource streams are requested. 

## Security Considerations

The author of this Internet-Draft does not anticipate that any serious considerations should arise from the adoption and usage of the SSRG specification on the Web. 

## IANA Considerations

This document has no IANA actions.

## References

### Normative References

[RFC9113] M. Thomson, Ed., Mozilla, C. Benfield, Ed., Apple Inc., "HTTP/2", RFC 9113, DOI 10.17487/RFC9113, June 2022, <https://www.rfc-editor.org/info/rfc9113>.

### Informative References

[surge-web] "Example JavaScript SSRG stream decoder", commit 557af22, November 2023, <https://github.com/IsaMorphic/surge-web>.
