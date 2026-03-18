# Test Fixtures

This directory contains test fixtures for the PDFService and ColorEngineService tests.

## Contents

- Sample PDF files for testing
- ICC profiles for color transformation tests
- Expected output files for comparison

## Usage

Tests will automatically load fixtures from this directory. Place new test files here
and reference them by path in test cases.

## Notes

- Large binary files (PDFs, ICC profiles) should be kept minimal for test purposes
- If using actual test form PDFs, prefer using the smallest representative sample
