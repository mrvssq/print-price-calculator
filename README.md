# 📙 Руководство по формированию `prices.json`

## Полная структура файла

```json
{
  "meta": { "version": "3.0.0", "updated": "2025-10-15" },

  "shared": {
    "fees": {
      "designFee": {
        "none": 0,
        "template": 0,
        "premium": 1500
      }
    }
  },

  "products": {
    "business-cards": {
      "base": {
        "basePerItem": {
          "paper300":   { "single": 5,   "double": 9   },
          "designer":{"single": 30,   "double": 40  },
          "plastic": { "single": 100, "double": 200 }
        },
        "sizeK":  { "90x50": 1.0, "60x60": 1.1 },
        "printK": { "single": 1.0, "double": 1.0 } 
      },
      "options": {
        "laminationMultiplier": 2.0,
        "roundedCornersPerItem": 2.0
      },
      "urgencyK": { "oneday": 1.0, "express": 1.5 },

      "qtyRules": {
        "paper300":    { "min": 120, "pack": 24 },
        "designer": { "min": 120, "pack": 24 },
        "plastic":  { "min": 30,  "pack": 1  }
      },

      "discountByAmount": {
        "startAmount": 1500,
        "startRate": 0.05,
        "midAmount": 4000,
        "midRate": 0.15,
        "capAmount": 20000,
        "capRate": 0.30
      }
    },

    "leaflets": {
      "base": {
        "sizes": ["A6","A5","A4","EURO","A3"],
        "gsmList": ["80","115","150","200","300"],

        "basePerItemSingle": {
          "A6":  { "80": 8, "115": 10, "150": 12, "200": 13, "300": 15 },
          "A5":  { "80": 15, "115": 20, "150": 23, "200": 25, "300": 30 },
          "A4":  { "80": 30, "115": 40, "150": 45, "200": 50, "300": 60 },
          "EURO":{"80": 30, "115": 40, "150": 45, "200": 50, "300": 60 },
          "A3":  { "80": 50, "115": 70, "150": 85, "200":100, "300":120 }
        },

        "doublePrintMultiplier": 1.40
      },

      "options": {
        "laminationMultiplier": 1.40,
        "roundedCornersPerItem": 2.0,
        "creasingPerLine": 3.0,
        "designerPaperMultiplier": 1.30
      },

      "urgencyK": { "oneday": 1.0, "express": 1.5 },

      "qtyRules": { "min": 1, "pack": 1 },

      "discountByAmount": {
        "startAmount": 1500,  "startRate": 0.05,
        "midAmount":   4000,  "midRate":   0.15,
        "capAmount":  20000,  "capRate":   0.30
      }
    }
  }
}

```
