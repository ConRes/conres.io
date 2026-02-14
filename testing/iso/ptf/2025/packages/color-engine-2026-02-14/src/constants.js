/// Pixel types and formats extracted using build/constants.js
///
/// If needed, these can be imported directly from the build/constants.js module:
///
///     export const { PT_GRAY, PT_RGB, PT_CMY, PT_CMYK, PT_Lab, TYPE_GRAY_8, TYPE_GRAY_16, TYPE_GRAY_FLT, TYPE_RGB_8, TYPE_RGB_16, TYPE_RGBA_8, TYPE_RGB_FLT, TYPE_CMYK_8, TYPE_CMYK_16, TYPE_CMYK_FLT, TYPE_Lab_8, TYPE_Lab_16, TYPE_Lab_FLT } = await import('./build/constants.js');
///

// Pixel format constants (matching Little-CMS)
export const PREMUL_SH = (m) => ((m) << 23);
export const FLOAT_SH = (a) => ((a) << 22);
export const OPTIMIZED_SH = (s) => ((s) << 21);
export const COLORSPACE_SH = (s) => ((s) << 16);
export const SWAPFIRST_SH = (s) => ((s) << 14);
export const FLAVOR_SH = (s) => ((s) << 13);
export const PLANAR_SH = (p) => ((p) << 12);
export const ENDIAN16_SH = (e) => ((e) << 11);
export const DOSWAP_SH = (e) => ((e) << 10);
export const EXTRA_SH = (e) => ((e) << 7);
export const CHANNELS_SH = (c) => ((c) << 3);
export const BYTES_SH = (b) => (b);

// Pixel type constants from lcms2.h (upstream/Little-CMS/include/lcms2.h:700-715)
export const PT_ANY = 0; // Don't check colorspace
export const PT_GRAY = 3;
export const PT_RGB = 4;
export const PT_CMY = 5;
export const PT_CMYK = 6;
export const PT_YCbCr = 7;
export const PT_YUV = 8; // Lu'v'
export const PT_XYZ = 9;
export const PT_Lab = 10;
export const PT_YUVK = 11; // Lu'v'K
export const PT_HSV = 12;
export const PT_HLS = 13;
export const PT_Yxy = 14;
export const PT_MCH1 = 15;
export const PT_MCH2 = 16;
export const PT_MCH3 = 17;
export const PT_MCH4 = 18;
export const PT_MCH5 = 19;
export const PT_MCH6 = 20;
export const PT_MCH7 = 21;
export const PT_MCH8 = 22;
export const PT_MCH9 = 23;
export const PT_MCH10 = 24;
export const PT_MCH11 = 25;
export const PT_MCH12 = 26;
export const PT_MCH13 = 27;
export const PT_MCH14 = 28;
export const PT_MCH15 = 29;
export const PT_LabV2 = 30; // Identical to PT_Lab, but using the V2 old encoding

// Pixel format definitions from lcms2.h (upstream/Little-CMS/include/lcms2.h:717-777)
export const TYPE_GRAY_8 = (COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(1));
export const TYPE_GRAY_8_REV = (COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(1) | FLAVOR_SH(1));
export const TYPE_GRAY_16 = (COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(2));
export const TYPE_GRAY_16_REV = (COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(2) | FLAVOR_SH(1));
export const TYPE_GRAY_16_SE = (COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_GRAYA_8 = (COLORSPACE_SH(PT_GRAY) | EXTRA_SH(1) | CHANNELS_SH(1) | BYTES_SH(1));
export const TYPE_GRAYA_8_PREMUL = (COLORSPACE_SH(PT_GRAY) | EXTRA_SH(1) | CHANNELS_SH(1) | BYTES_SH(1) | PREMUL_SH(1));
export const TYPE_GRAYA_16 = (COLORSPACE_SH(PT_GRAY) | EXTRA_SH(1) | CHANNELS_SH(1) | BYTES_SH(2));
export const TYPE_GRAYA_16_PREMUL = (COLORSPACE_SH(PT_GRAY) | EXTRA_SH(1) | CHANNELS_SH(1) | BYTES_SH(2) | PREMUL_SH(1));
export const TYPE_GRAYA_16_SE = (COLORSPACE_SH(PT_GRAY) | EXTRA_SH(1) | CHANNELS_SH(1) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_GRAYA_8_PLANAR = (COLORSPACE_SH(PT_GRAY) | EXTRA_SH(1) | CHANNELS_SH(1) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_GRAYA_16_PLANAR = (COLORSPACE_SH(PT_GRAY) | EXTRA_SH(1) | CHANNELS_SH(1) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_RGB_8 = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_RGB_8_PLANAR = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_BGR_8 = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_BGR_8_PLANAR = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(1) | DOSWAP_SH(1) | PLANAR_SH(1));
export const TYPE_RGB_16 = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_RGB_16_PLANAR = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_RGB_16_SE = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_BGR_16 = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_BGR_16_PLANAR = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1) | PLANAR_SH(1));
export const TYPE_BGR_16_SE = (COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_RGBA_8 = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_RGBA_8_PREMUL = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | PREMUL_SH(1));
export const TYPE_RGBA_8_PLANAR = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_RGBA_16 = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_RGBA_16_PREMUL = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | PREMUL_SH(1));
export const TYPE_RGBA_16_PLANAR = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_RGBA_16_SE = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_ARGB_8 = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | SWAPFIRST_SH(1));
export const TYPE_ARGB_8_PREMUL = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | SWAPFIRST_SH(1) | PREMUL_SH(1));
export const TYPE_ARGB_8_PLANAR = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | SWAPFIRST_SH(1) | PLANAR_SH(1));
export const TYPE_ARGB_16 = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | SWAPFIRST_SH(1));
export const TYPE_ARGB_16_PREMUL = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | SWAPFIRST_SH(1) | PREMUL_SH(1));
export const TYPE_ABGR_8 = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_ABGR_8_PREMUL = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | DOSWAP_SH(1) | PREMUL_SH(1));
export const TYPE_ABGR_8_PLANAR = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | DOSWAP_SH(1) | PLANAR_SH(1));
export const TYPE_ABGR_16 = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_ABGR_16_PREMUL = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1) | PREMUL_SH(1));
export const TYPE_ABGR_16_PLANAR = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1) | PLANAR_SH(1));
export const TYPE_ABGR_16_SE = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_BGRA_8 = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | DOSWAP_SH(1) | SWAPFIRST_SH(1));
export const TYPE_BGRA_8_PREMUL = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | DOSWAP_SH(1) | SWAPFIRST_SH(1) | PREMUL_SH(1));
export const TYPE_BGRA_8_PLANAR = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(1) | DOSWAP_SH(1) | SWAPFIRST_SH(1) | PLANAR_SH(1));
export const TYPE_BGRA_16 = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1) | SWAPFIRST_SH(1));
export const TYPE_BGRA_16_PREMUL = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1) | SWAPFIRST_SH(1) | PREMUL_SH(1));
export const TYPE_BGRA_16_SE = (COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | ENDIAN16_SH(1) | DOSWAP_SH(1) | SWAPFIRST_SH(1));
export const TYPE_CMY_8 = (COLORSPACE_SH(PT_CMY) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_CMY_8_PLANAR = (COLORSPACE_SH(PT_CMY) | CHANNELS_SH(3) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_CMY_16 = (COLORSPACE_SH(PT_CMY) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_CMY_16_PLANAR = (COLORSPACE_SH(PT_CMY) | CHANNELS_SH(3) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_CMY_16_SE = (COLORSPACE_SH(PT_CMY) | CHANNELS_SH(3) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_CMYK_8 = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(1));
export const TYPE_CMYKA_8 = (COLORSPACE_SH(PT_CMYK) | EXTRA_SH(1) | CHANNELS_SH(4) | BYTES_SH(1));
export const TYPE_CMYK_8_REV = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(1) | FLAVOR_SH(1));
export const TYPE_YUVK_8 = TYPE_CMYK_8_REV;
export const TYPE_CMYK_8_PLANAR = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_CMYK_16 = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2));
export const TYPE_CMYK_16_REV = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2) | FLAVOR_SH(1));
export const TYPE_YUVK_16 = TYPE_CMYK_16_REV;
export const TYPE_CMYK_16_PLANAR = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_CMYK_16_SE = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_KYMC_8 = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_KYMC_16 = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_KYMC_16_SE = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_KCMY_8 = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(1) | SWAPFIRST_SH(1));
export const TYPE_KCMY_8_REV = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(1) | FLAVOR_SH(1) | SWAPFIRST_SH(1));
export const TYPE_KCMY_16 = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2) | SWAPFIRST_SH(1));
export const TYPE_KCMY_16_REV = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2) | FLAVOR_SH(1) | SWAPFIRST_SH(1));
export const TYPE_KCMY_16_SE = (COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2) | ENDIAN16_SH(1) | SWAPFIRST_SH(1));
export const TYPE_CMYK5_8 = (COLORSPACE_SH(PT_MCH5) | CHANNELS_SH(5) | BYTES_SH(1));
export const TYPE_CMYK5_16 = (COLORSPACE_SH(PT_MCH5) | CHANNELS_SH(5) | BYTES_SH(2));
export const TYPE_CMYK5_16_SE = (COLORSPACE_SH(PT_MCH5) | CHANNELS_SH(5) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_KYMC5_8 = (COLORSPACE_SH(PT_MCH5) | CHANNELS_SH(5) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_KYMC5_16 = (COLORSPACE_SH(PT_MCH5) | CHANNELS_SH(5) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_KYMC5_16_SE = (COLORSPACE_SH(PT_MCH5) | CHANNELS_SH(5) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_CMYK6_8 = (COLORSPACE_SH(PT_MCH6) | CHANNELS_SH(6) | BYTES_SH(1));
export const TYPE_CMYK6_8_PLANAR = (COLORSPACE_SH(PT_MCH6) | CHANNELS_SH(6) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_CMYK6_16 = (COLORSPACE_SH(PT_MCH6) | CHANNELS_SH(6) | BYTES_SH(2));
export const TYPE_CMYK6_16_PLANAR = (COLORSPACE_SH(PT_MCH6) | CHANNELS_SH(6) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_CMYK6_16_SE = (COLORSPACE_SH(PT_MCH6) | CHANNELS_SH(6) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_CMYK7_8 = (COLORSPACE_SH(PT_MCH7) | CHANNELS_SH(7) | BYTES_SH(1));
export const TYPE_CMYK7_16 = (COLORSPACE_SH(PT_MCH7) | CHANNELS_SH(7) | BYTES_SH(2));
export const TYPE_CMYK7_16_SE = (COLORSPACE_SH(PT_MCH7) | CHANNELS_SH(7) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_KYMC7_8 = (COLORSPACE_SH(PT_MCH7) | CHANNELS_SH(7) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_KYMC7_16 = (COLORSPACE_SH(PT_MCH7) | CHANNELS_SH(7) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_KYMC7_16_SE = (COLORSPACE_SH(PT_MCH7) | CHANNELS_SH(7) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_CMYK8_8 = (COLORSPACE_SH(PT_MCH8) | CHANNELS_SH(8) | BYTES_SH(1));
export const TYPE_CMYK8_16 = (COLORSPACE_SH(PT_MCH8) | CHANNELS_SH(8) | BYTES_SH(2));
export const TYPE_CMYK8_16_SE = (COLORSPACE_SH(PT_MCH8) | CHANNELS_SH(8) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_KYMC8_8 = (COLORSPACE_SH(PT_MCH8) | CHANNELS_SH(8) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_KYMC8_16 = (COLORSPACE_SH(PT_MCH8) | CHANNELS_SH(8) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_KYMC8_16_SE = (COLORSPACE_SH(PT_MCH8) | CHANNELS_SH(8) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_CMYK9_8 = (COLORSPACE_SH(PT_MCH9) | CHANNELS_SH(9) | BYTES_SH(1));
export const TYPE_CMYK9_16 = (COLORSPACE_SH(PT_MCH9) | CHANNELS_SH(9) | BYTES_SH(2));
export const TYPE_CMYK9_16_SE = (COLORSPACE_SH(PT_MCH9) | CHANNELS_SH(9) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_KYMC9_8 = (COLORSPACE_SH(PT_MCH9) | CHANNELS_SH(9) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_KYMC9_16 = (COLORSPACE_SH(PT_MCH9) | CHANNELS_SH(9) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_KYMC9_16_SE = (COLORSPACE_SH(PT_MCH9) | CHANNELS_SH(9) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_CMYK10_8 = (COLORSPACE_SH(PT_MCH10) | CHANNELS_SH(10) | BYTES_SH(1));
export const TYPE_CMYK10_16 = (COLORSPACE_SH(PT_MCH10) | CHANNELS_SH(10) | BYTES_SH(2));
export const TYPE_CMYK10_16_SE = (COLORSPACE_SH(PT_MCH10) | CHANNELS_SH(10) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_KYMC10_8 = (COLORSPACE_SH(PT_MCH10) | CHANNELS_SH(10) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_KYMC10_16 = (COLORSPACE_SH(PT_MCH10) | CHANNELS_SH(10) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_KYMC10_16_SE = (COLORSPACE_SH(PT_MCH10) | CHANNELS_SH(10) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_CMYK11_8 = (COLORSPACE_SH(PT_MCH11) | CHANNELS_SH(11) | BYTES_SH(1));
export const TYPE_CMYK11_16 = (COLORSPACE_SH(PT_MCH11) | CHANNELS_SH(11) | BYTES_SH(2));
export const TYPE_CMYK11_16_SE = (COLORSPACE_SH(PT_MCH11) | CHANNELS_SH(11) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_KYMC11_8 = (COLORSPACE_SH(PT_MCH11) | CHANNELS_SH(11) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_KYMC11_16 = (COLORSPACE_SH(PT_MCH11) | CHANNELS_SH(11) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_KYMC11_16_SE = (COLORSPACE_SH(PT_MCH11) | CHANNELS_SH(11) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_CMYK12_8 = (COLORSPACE_SH(PT_MCH12) | CHANNELS_SH(12) | BYTES_SH(1));
export const TYPE_CMYK12_16 = (COLORSPACE_SH(PT_MCH12) | CHANNELS_SH(12) | BYTES_SH(2));
export const TYPE_CMYK12_16_SE = (COLORSPACE_SH(PT_MCH12) | CHANNELS_SH(12) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_KYMC12_8 = (COLORSPACE_SH(PT_MCH12) | CHANNELS_SH(12) | BYTES_SH(1) | DOSWAP_SH(1));
export const TYPE_KYMC12_16 = (COLORSPACE_SH(PT_MCH12) | CHANNELS_SH(12) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_KYMC12_16_SE = (COLORSPACE_SH(PT_MCH12) | CHANNELS_SH(12) | BYTES_SH(2) | DOSWAP_SH(1) | ENDIAN16_SH(1));
export const TYPE_XYZ_16 = (COLORSPACE_SH(PT_XYZ) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_Lab_8 = (COLORSPACE_SH(PT_Lab) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_LabV2_8 = (COLORSPACE_SH(PT_LabV2) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_ALab_8 = (COLORSPACE_SH(PT_Lab) | CHANNELS_SH(3) | BYTES_SH(1) | EXTRA_SH(1) | SWAPFIRST_SH(1));
export const TYPE_ALabV2_8 = (COLORSPACE_SH(PT_LabV2) | CHANNELS_SH(3) | BYTES_SH(1) | EXTRA_SH(1) | SWAPFIRST_SH(1));
export const TYPE_Lab_16 = (COLORSPACE_SH(PT_Lab) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_LabV2_16 = (COLORSPACE_SH(PT_LabV2) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_Yxy_16 = (COLORSPACE_SH(PT_Yxy) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_YCbCr_8 = (COLORSPACE_SH(PT_YCbCr) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_YCbCr_8_PLANAR = (COLORSPACE_SH(PT_YCbCr) | CHANNELS_SH(3) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_YCbCr_16 = (COLORSPACE_SH(PT_YCbCr) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_YCbCr_16_PLANAR = (COLORSPACE_SH(PT_YCbCr) | CHANNELS_SH(3) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_YCbCr_16_SE = (COLORSPACE_SH(PT_YCbCr) | CHANNELS_SH(3) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_YUV_8 = (COLORSPACE_SH(PT_YUV) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_YUV_8_PLANAR = (COLORSPACE_SH(PT_YUV) | CHANNELS_SH(3) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_YUV_16 = (COLORSPACE_SH(PT_YUV) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_YUV_16_PLANAR = (COLORSPACE_SH(PT_YUV) | CHANNELS_SH(3) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_YUV_16_SE = (COLORSPACE_SH(PT_YUV) | CHANNELS_SH(3) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_HLS_8 = (COLORSPACE_SH(PT_HLS) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_HLS_8_PLANAR = (COLORSPACE_SH(PT_HLS) | CHANNELS_SH(3) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_HLS_16 = (COLORSPACE_SH(PT_HLS) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_HLS_16_PLANAR = (COLORSPACE_SH(PT_HLS) | CHANNELS_SH(3) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_HLS_16_SE = (COLORSPACE_SH(PT_HLS) | CHANNELS_SH(3) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_HSV_8 = (COLORSPACE_SH(PT_HSV) | CHANNELS_SH(3) | BYTES_SH(1));
export const TYPE_HSV_8_PLANAR = (COLORSPACE_SH(PT_HSV) | CHANNELS_SH(3) | BYTES_SH(1) | PLANAR_SH(1));
export const TYPE_HSV_16 = (COLORSPACE_SH(PT_HSV) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_HSV_16_PLANAR = (COLORSPACE_SH(PT_HSV) | CHANNELS_SH(3) | BYTES_SH(2) | PLANAR_SH(1));
export const TYPE_HSV_16_SE = (COLORSPACE_SH(PT_HSV) | CHANNELS_SH(3) | BYTES_SH(2) | ENDIAN16_SH(1));
export const TYPE_NAMED_COLOR_INDEX = (CHANNELS_SH(1) | BYTES_SH(2));
export const TYPE_XYZ_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_XYZ) | CHANNELS_SH(3) | BYTES_SH(4));
export const TYPE_Lab_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_Lab) | CHANNELS_SH(3) | BYTES_SH(4));
export const TYPE_LabA_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_Lab) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4));
export const TYPE_GRAY_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(4));
export const TYPE_GRAYA_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(4) | EXTRA_SH(1));
export const TYPE_GRAYA_FLT_PREMUL = (FLOAT_SH(1) | COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(4) | EXTRA_SH(1) | PREMUL_SH(1));
export const TYPE_RGB_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(4));
export const TYPE_RGBA_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4));
export const TYPE_RGBA_FLT_PREMUL = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4) | PREMUL_SH(1));
export const TYPE_ARGB_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4) | SWAPFIRST_SH(1));
export const TYPE_ARGB_FLT_PREMUL = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4) | SWAPFIRST_SH(1) | PREMUL_SH(1));
export const TYPE_BGR_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(4) | DOSWAP_SH(1));
export const TYPE_BGRA_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4) | DOSWAP_SH(1) | SWAPFIRST_SH(1));
export const TYPE_BGRA_FLT_PREMUL = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4) | DOSWAP_SH(1) | SWAPFIRST_SH(1) | PREMUL_SH(1));
export const TYPE_ABGR_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4) | DOSWAP_SH(1));
export const TYPE_ABGR_FLT_PREMUL = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(4) | DOSWAP_SH(1) | PREMUL_SH(1));
export const TYPE_CMYK_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(4));
export const TYPE_XYZ_DBL = (FLOAT_SH(1) | COLORSPACE_SH(PT_XYZ) | CHANNELS_SH(3) | BYTES_SH(0));
export const TYPE_Lab_DBL = (FLOAT_SH(1) | COLORSPACE_SH(PT_Lab) | CHANNELS_SH(3) | BYTES_SH(0));
export const TYPE_GRAY_DBL = (FLOAT_SH(1) | COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(0));
export const TYPE_RGB_DBL = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(0));
export const TYPE_BGR_DBL = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(0) | DOSWAP_SH(1));
export const TYPE_CMYK_DBL = (FLOAT_SH(1) | COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(0));
export const TYPE_OKLAB_DBL = (FLOAT_SH(1) | COLORSPACE_SH(PT_MCH3) | CHANNELS_SH(3) | BYTES_SH(0));
export const TYPE_GRAY_HALF_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_GRAY) | CHANNELS_SH(1) | BYTES_SH(2));
export const TYPE_RGB_HALF_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_CMYK_HALF_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_CMYK) | CHANNELS_SH(4) | BYTES_SH(2));
export const TYPE_RGBA_HALF_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2));
export const TYPE_ARGB_HALF_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | SWAPFIRST_SH(1));
export const TYPE_BGR_HALF_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1));
export const TYPE_BGRA_HALF_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | EXTRA_SH(1) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1) | SWAPFIRST_SH(1));
export const TYPE_ABGR_HALF_FLT = (FLOAT_SH(1) | COLORSPACE_SH(PT_RGB) | CHANNELS_SH(3) | BYTES_SH(2) | DOSWAP_SH(1));

// Intents from lcms2.h (upstream/Little-CMS/include/lcms2.h:1700-1715)
export const INTENT_PERCEPTUAL = 0;
export const INTENT_RELATIVE_COLORIMETRIC = 1;
export const INTENT_SATURATION = 2;
export const INTENT_ABSOLUTE_COLORIMETRIC = 3;
export const INTENT_PRESERVE_K_ONLY_PERCEPTUAL = 10;
export const INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC = 11;
export const INTENT_PRESERVE_K_ONLY_SATURATION = 12;
export const INTENT_PRESERVE_K_PLANE_PERCEPTUAL = 13;
export const INTENT_PRESERVE_K_PLANE_RELATIVE_COLORIMETRIC = 14;
export const INTENT_PRESERVE_K_PLANE_SATURATION = 15;

// Flags from lcms2.h (upstream/Little-CMS/include/lcms2.h:1720-1756)
export const cmsFLAGS_NOCACHE = 0x0040; // Inhibit 1-pixel cache
export const cmsFLAGS_NOOPTIMIZE = 0x0100; // Inhibit optimizations
export const cmsFLAGS_NULLTRANSFORM = 0x0200; // Don't transform anyway
export const cmsFLAGS_GAMUTCHECK = 0x1000; // Out of Gamut alarm
export const cmsFLAGS_SOFTPROOFING = 0x4000; // Do softproofing
export const cmsFLAGS_BLACKPOINTCOMPENSATION = 0x2000;
export const cmsFLAGS_NOWHITEONWHITEFIXUP = 0x0004; // Don't fix scum dot
export const cmsFLAGS_HIGHRESPRECALC = 0x0400; // Use more memory to give better accuracy
export const cmsFLAGS_LOWRESPRECALC = 0x0800; // Use less memory to minimize resources
export const cmsFLAGS_8BITS_DEVICELINK = 0x0008; // Create 8 bits devicelinks
export const cmsFLAGS_GUESSDEVICECLASS = 0x0020; // Guess device class (for transform2devicelink)
export const cmsFLAGS_KEEP_SEQUENCE = 0x0080; // Keep profile sequence for devicelink creation
export const cmsFLAGS_FORCE_CLUT = 0x0002; // Force CLUT optimization
export const cmsFLAGS_CLUT_POST_LINEARIZATION = 0x0001; // create postlinearization tables if possible
export const cmsFLAGS_CLUT_PRE_LINEARIZATION = 0x0010; // create prelinearization tables if possible
export const cmsFLAGS_NONEGATIVES = 0x8000; // Prevent negative numbers in floating point transforms
export const cmsFLAGS_COPY_ALPHA = 0x04000000; // Alpha channels are copied on cmsDoTransform()
export const cmsFLAGS_GRIDPOINTS = (n) => (((n) & 0xFF) << 16);
export const cmsFLAGS_NODEFAULTRESOURCEDEF = 0x01000000;

/**
 * Custom intent: K-Only Black Point Compensation with Gray Component Replacement
 *
 * **Purpose:** Guarantees neutral gray inputs convert to K-only CMYK output.
 *
 * **Behavior:**
 * - Uses CMYK(0,0,0,100) as black reference instead of CMYK(100,100,100,100)
 * - Neutral gray inputs → CMYK with C=0, M=0, Y=0, K>0
 * - Black input → CMYK(0,0,0,255) (pure K)
 * - White input → CMYK(0,0,0,0) (no ink)
 * - Chromatic colors still produce CMY components as needed
 *
 * **Requirements:**
 * - Output profile must be CMYK
 * - Works with both 2-profile and multiprofile transforms
 * - For multiprofile with non-RGB input, sRGB intermediate is automatically inserted
 *
 * @type {number}
 * @constant
 * @example
 * // K-Only GCR with multiprofile transform
 * const transformHandle = engine.createMultiprofileTransform(
 *   [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
 *   TYPE_GRAY_8,
 *   TYPE_CMYK_8,
 *   INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
 *   cmsFLAGS_BLACKPOINTCOMPENSATION
 * );
 */
export const INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR = 20;


/**
 * Enable explicit blackpoint scaling for multiprofile LUT creation.
 * Uses 32-bit float intermediates and applies XYZ-space blackpoint scaling
 * to ensure pure black → pure black mapping.
 * @type {number}
 */
export const cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING = 0x20000000;

/**
 * @deprecated Use cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING instead.
 */
export {cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING as cmsFLAGS_MULTIPROFILE_BPC_SCALING};

/**
 * Enable blackpoint compensation clamping optimization.
 * Caches boundary pixel transform results and uses SIMD-accelerated
 * boundary detection to skip full LittleCMS pipeline for pure black/white pixels.
 * Transparent: pass this flag to createTransform and use normal doTransform.
 * @type {number}
 */
export const cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING = 0x80000000;

export const cmsFLAGS_DEBUG_COLOR_ENGINE = 0x40000000;

