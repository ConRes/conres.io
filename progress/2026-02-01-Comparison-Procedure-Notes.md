# Comparison Procedure

Standard procedure for comparing legacy vs refactored PDF color conversion implementations.

## File Paths

### Test PDFs

| PDF                | Path                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| F9d Fixtures       | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf`      |
| Type Sizes         | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf`  |
| Interlaken 300 DPI | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map (300 DPI).pdf` |
| Interlaken Full    | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf`           |
| Full CR1           | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1.pdf`                            |

### ICC Profiles

| Profile               | Color Space | Path                                                                                                 |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| eciCMYK v2            | CMYK        | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles/eciCMYK v2.icc`            |
| FIPS_WIDE_28T-TYPEavg | RGB         | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles/FIPS_WIDE_28T-TYPEavg.icc` |
| sRGB IEC61966-2.1     | RGB         | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles/sRGB IEC61966-2.1.icc`     |
| sRGB v4               | RGB         | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles/sRGB v4.icc`               |
| sGray                 | Gray        | `~/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles/sGray.icc`                 |

### Scripts Directory

```
~/Projects/conres/conres.io/testing/iso/ptf/2025/experiments/scripts/
```

### Output Directory Pattern

```
~/Projects/conres/conres.io/testing/iso/ptf/2025/experiments/output/YYYY-MM-DD-XXX/
```

## Comparison Commands

### 1. Check Existing Output Folders

```bash
ls -d ~/Projects/conres/conres.io/testing/iso/ptf/2025/experiments/output/$(date +%Y-%m-%d)* 2>/dev/null | sort | tail -5
```

### 2. Create Output Folder

```bash
mkdir -p ~/Projects/conres/conres.io/testing/iso/ptf/2025/experiments/output/YYYY-MM-DD-XXX
```

### 3. Run Comparison with eciCMYK v2 (CMYK)

```bash
cd ~/Projects/conres/conres.io/testing/iso/ptf/2025/experiments/scripts && \
node compare-implementations.js \
  "$HOME/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs/<PDF_NAME>.pdf" \
  "$HOME/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles/eciCMYK v2.icc" \
  --output-dir ../output/YYYY-MM-DD-XXX \
  --verbose 2>&1 | tee "../output/YYYY-MM-DD-XXX/comparison-eciCMYK-v2.log"
```

### 4. Run Comparison with FIPS_WIDE_28T-TYPEavg (RGB)

```bash
cd ~/Projects/conres/conres.io/testing/iso/ptf/2025/experiments/scripts && \
node compare-implementations.js \
  "$HOME/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs/<PDF_NAME>.pdf" \
  "$HOME/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles/FIPS_WIDE_28T-TYPEavg.icc" \
  --output-dir ../output/YYYY-MM-DD-XXX \
  --verbose 2>&1 | tee "../output/YYYY-MM-DD-XXX/comparison-FIPS_WIDE.log"
```

## Expected Results

### Content Stream Conversions

| Metric                     | Legacy | Refactored | Notes                                     |
| -------------------------- | ------ | ---------- | ----------------------------------------- |
| Content stream conversions | N      | M          | Legacy counts individual color operations |
| Streams processed          | X      | Y          | Refactored counts content streams         |

**Note:** Legacy `totalContentStreamConversions` counts individual color operator replacements.
Refactored `contentStreamsConverted` counts the number of content streams that had changes.
These numbers are expected to differ - compare actual color values in the PDF, not just counts.

### Image Conversions

Should match exactly between legacy and refactored implementations.

### Visual Verification

After running comparisons, open both PDFs in a PDF viewer to verify:

1. Colors appear the same
2. No visual artifacts
3. No missing content

## Troubleshooting

### "Failed to fetch" Error

Usually indicates a profile loading issue. Check:

- Profile path is correct
- Profile is passed as `ArrayBuffer`, not `Uint8Array`

### Zero Content Stream Conversions

Check that:

1. `decodePDFRawStream()` is used to decompress FlateDecode streams
2. `colorSpaceDefinitions` is passed correctly to content stream converter

### Hash Mismatch

Expected in most cases due to:

- Different compression settings
- Different object ordering in PDF
- Timestamps in PDF metadata

Visual inspection is required to confirm parity.
