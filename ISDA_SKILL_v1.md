# SKILL.md: Irreducible Semantic Density Analysis (ISDA)

## Overview

**Irreducible Semantic Density Analysis (ISDA)** is a structured framework for estimating the compressibility of written content. It answers the practical question: *"How much of this text is genuinely necessary to convey its core intellectual contribution?"*

Unlike raw Kolmogorov complexity (which measures the shortest program to reproduce a string exactly), ISDA measures **semantic Kolmogorov complexity**: the minimal description length required to reconstruct the *meaning* and *argumentative force* of a text, not its literal characters.

The core question ISDA answers: **Could this have been a tweet? A paragraph? Or does it genuinely require its current length?**

---

## The Five Strata of Textual Information

ISDA decomposes any text into five strata, each with different compressibility characteristics:

### Stratum 1: Structural Skeleton (S₁)
**Definition:** The formal architecture of the text independent of content.

**Includes:**
- Document type (essay, letter, proof, narrative, report)
- Section hierarchy and organization
- Rhetorical mode (expository, argumentative, descriptive, narrative)
- Template patterns that repeat
- Formatting conventions

**Measurement:** Describe the structure in minimal notation. Count bytes.

**Example:** "5-part essay with [Intro → Literature Review → Methods → Results → Discussion]" ≈ 75 bytes

**Compressibility:** High. Most structures are conventional and can be specified briefly.

---

### Stratum 2: Retrievable Knowledge (S₂)
**Definition:** Information that exists in standard reference sources and could be retrieved by a competent reader or language model with appropriate domain access.

**Includes:**
- Direct quotations from sources
- Definitions and translations
- Historical facts and dates
- Biographical data
- Statistical data from cited sources
- Standard interpretations within a field
- Established theories or frameworks

**Measurement:** List each retrievable item with a minimal pointer (e.g., citation key, database reference, URL stub). Sum pointer lengths.

**Example pointers:**
- Academic citation: `Smith.2019.p42` (14 bytes)
- Scripture: `Gen.2.9` (7 bytes)
- Dictionary entry: `OED.sublime.n.2` (15 bytes)
- Historical fact: `WWI.armistice.1918.11.11` (24 bytes)

**Compressibility:** Near-total. Pointers replace content.

---

### Stratum 3: Derived Inferences (S₃)
**Definition:** Claims that follow logically or conventionally from S₂ without requiring special insight. These are moves that "any competent practitioner would make" given the inputs.

**Includes:**
- Standard analytical moves in a discipline
- Predictable cross-references
- Conventional scholarly apparatus
- Logical deductions from stated premises
- Standard interpretive frameworks applied to data
- "Textbook" observations

**Measurement:** Count inferences. Encode each as [method] + [input] → [output]. Estimate bytes.

**Example encodings:**
- `statistical_test(data, t-test) → significance` (40 bytes)
- `etymology(word, PIE) → root_meaning` (35 bytes)
- `legal_precedent(case, doctrine) → application` (45 bytes)

**Compressibility:** High. Can be encoded as "apply standard method X to input Y."

---

### Stratum 4: Curatorial Decisions (S₄)
**Definition:** The author's choices about selection, arrangement, emphasis, and juxtaposition that are not mechanically derivable from sources or methods.

**Includes:**
- Which sources to cite (among many valid options)
- Which details to foreground vs. background
- Structural innovations or unusual organization
- Scope decisions (what to include/exclude)
- Sequencing and ordering choices
- Voice and register decisions
- Which examples to use
- Framing and angle of approach

**Measurement:** Enumerate distinct non-obvious choices. Estimate bits required to specify each choice from the space of alternatives using log₂(|choice_space|).

**Example calculations:**
- "Select 5 examples from pool of 50" → log₂(C(50,5)) ≈ 22 bits
- "Choose argumentative frame from 8 options" → log₂(8) = 3 bits
- "Order 6 sections (non-obvious sequence)" → log₂(6!) ≈ 9.5 bits

**Compressibility:** Moderate. Requires explicit specification but can often be encoded efficiently as bits of selection.

---

### Stratum 5: Generative Novelty (S₅)
**Definition:** Content that cannot be derived from existing sources or standard methods—genuine intellectual creation that did not exist before this text.

**Includes:**
- Novel arguments or interpretations
- Original phrasings that carry meaning (aphorisms, memorable formulations)
- Unexpected connections between disparate domains
- Insights that would surprise domain experts
- New frameworks or taxonomies
- Creative coinages or reframings
- Rhetorical moves that could not be predicted from the material

**Measurement:** Isolate each novel contribution. Transcribe verbatim. Sum bytes.

**Compressibility:** Low to none. This is the irreducible core—the reason the text exists.

---

## The ISDA Protocol

### Step 1: Measure Raw Length
Count total bytes (or characters) of the text.

### Step 2: Structural Decomposition
Map the text onto S₁–S₅. Create a ledger:

```
| Stratum | Description | Raw Bytes | Compressed Estimate |
|---------|-------------|-----------|---------------------|
| S₁      |             |           |                     |
| S₂      |             |           |                     |
| S₃      |             |           |                     |
| S₄      |             |           |                     |
| S₅      |             |           |                     |
| TOTAL   |             |           |                     |
```

### Step 3: Encode Structure (S₁)
Describe the document's architecture in minimal notation. Use conventional shorthands for standard structures.

### Step 4: Pointer Compression (S₂)
For each piece of retrievable knowledge, replace content with minimal pointer:
- Use citation keys, database IDs, or canonical references
- Track both pointer length and raw content length replaced

### Step 5: Inference Encoding (S₃)
For derived inferences, encode as [method] + [input] → [output]:
- Identify the standard method being applied
- Identify the input data or premise
- Note that the output is predictable given method + input

### Step 6: Decision Enumeration (S₄)
List curatorial decisions with cardinality of choice space:
- For each non-obvious authorial choice, estimate the number of reasonable alternatives
- Calculate bits: log₂(|alternatives|)
- Sum total bits, convert to bytes (÷ 8)
- Account for interdependencies if decisions are not independent

### Step 7: Novelty Extraction (S₅)
Identify and transcribe irreducibly novel content verbatim:
- Extract phrases, sentences, or passages that could not be reconstructed from sources
- Be rigorous: if it could be derived, it belongs in S₃
- This is the **hard core** of the text

### Step 8: Compute Metrics

**Semantic Compression Ratio (SCR):**
```
SCR = Raw_Bytes / (S₁ + S₂_compressed + S₃_compressed + S₄ + S₅)
```

**Novelty Density (ND):**
```
ND = S₅ / Raw_Bytes
```

**Retrievability Index (RI):**
```
RI = (S₂_raw + S₃_raw) / Raw_Bytes
```

**Could-Be-A-Tweet Test (CBAT):**
```
If S₅ < 280 characters → YES
If S₅ ≥ 280 characters → NO
```

---

## Interpretation Guide

### Semantic Compression Ratio (SCR)

| SCR | Interpretation |
|-----|----------------|
| < 2 | Extremely dense, minimal text. Almost no elaboration. |
| 2–5 | Well-developed argument with necessary support. Efficient. |
| 5–10 | Expansive treatment; could be condensed significantly without meaning loss. |
| 10–20 | Verbose; core idea may be buried in apparatus or padding. |
| > 20 | Severely bloated; likely contains substantial redundancy or filler. |

### Novelty Density (ND)

| ND | Interpretation |
|----|----------------|
| > 0.20 | Highly original, groundbreaking work. Rare. |
| 0.10–0.20 | Strong original contribution with supporting material. |
| 0.05–0.10 | Solid contribution; primarily synthesis with genuine insights. |
| 0.02–0.05 | Primarily synthesis, commentary, or review. Value is in curation. |
| < 0.02 | Essentially derivative; original contribution is minimal. |

### Retrievability Index (RI)

| RI | Interpretation |
|----|----------------|
| > 0.80 | Heavily dependent on sources; encyclopedic or review-like. |
| 0.50–0.80 | Balanced use of sources with substantial authorial contribution. |
| 0.20–0.50 | Source-light; more original argumentation than citation. |
| < 0.20 | Minimally sourced; either highly original or under-supported. |

### Could-Be-A-Tweet Test (CBAT)

| Result | Interpretation |
|--------|----------------|
| YES | Core insight is compact; length serves elaboration, evidence, or persuasion. The text *could* be radically compressed without total meaning loss. |
| NO | Argument is inherently complex or multi-part; length is more necessary. Compression would lose essential content. |

Note: CBAT = YES does not mean the text *should* be a tweet. Elaboration may be justified by genre, audience, or purpose.

---

## Compression Potential Table

Use this template to show how the text could be compressed to various lengths:

| Target Length | What Survives |
|---------------|---------------|
| Tweet (280 chars) | [Thesis only, single claim] |
| Paragraph (500–800 chars) | [Thesis + key insight + main support] |
| Abstract (1,500–2,000 chars) | [Above + one developed example + conclusion] |
| Short article (5,000 chars) | [All S₅ content + selective S₂/S₃ evidence] |
| Full length | [Complete development] |

---

## Applications

1. **Self-editing:** Identify which passages are S₂/S₃ (potentially cuttable) vs. S₅ (essential to preserve).

2. **Compression challenges:** Generate tweet-length, paragraph-length, or abstract-length versions by retaining only S₅ (and minimal S₁).

3. **Quality assessment:** High ND suggests genuine intellectual work; low ND may indicate derivative content.

4. **Plagiarism/originality analysis:** High S₂, near-zero S₅ suggests insufficient original contribution.

5. **AI-generated text heuristic:** AI text often exhibits high S₂/S₃ (accurate retrieval and inference) but low S₅ (genuine novelty). ISDA can help distinguish.

6. **Genre calibration:** Different genres have different expected profiles:
   - Literature review: High RI, low ND (appropriate)
   - Original research: Moderate RI, higher ND (expected)
   - Opinion/essay: Low RI, variable ND
   - Technical documentation: High RI, near-zero ND (appropriate)

7. **Editing feedback:** "Your S₅ is strong but buried under excessive S₂. Consider cutting 40% of quotations."

---

## Worked Example Template

**Text:** [Title]  
**Genre:** [essay / research paper / report / etc.]  
**Raw length:** X bytes

### Stratum Breakdown

**S₁ (Structure):**  
[Describe document architecture in minimal notation]  
→ X bytes compressed

**S₂ (Retrievable):**
| Item | Pointer | Bytes |
|------|---------|-------|
| [source/fact] | [minimal reference] | X |
| ... | ... | ... |

Total: X items → X bytes compressed (replacing X bytes raw)

**S₃ (Derived):**
| Inference | Encoding | Bytes |
|-----------|----------|-------|
| [claim] | [method(input) → output] | X |
| ... | ... | ... |

Total: X inferences → X bytes compressed (replacing X bytes raw)

**S₄ (Curatorial):**
| Decision | Choice Space | Bits |
|----------|--------------|------|
| [choice made] | X alternatives | log₂(X) |
| ... | ... | ... |

Total: X decisions → X bits ≈ X bytes

**S₅ (Novel):**
- "[exact quote of irreducible content]" (X bytes)
- "[exact quote]" (X bytes)
- ...

Total: X bytes

### Metrics

| Metric | Value |
|--------|-------|
| Raw Bytes | X |
| Compressed Total | X |
| SCR | X |
| ND | X% |
| RI | X% |
| CBAT | YES/NO |

### Compression Potential

| Target | Content |
|--------|---------|
| Tweet | [compressed version] |
| Paragraph | [compressed version] |
| Abstract | [compressed version] |

### Interpretation

[Analysis of what the metrics reveal about this specific text, its genre-appropriateness, and recommendations if any]

---

## Limitations and Caveats

1. **Subjectivity in S₄/S₅ boundary:** Reasonable analysts may disagree on what counts as "non-obvious" or "novel." Expertise in the domain improves accuracy.

2. **Domain expertise required:** Accurate S₂/S₃ assessment requires knowing what is "retrievable" or "standard" in a field. An outsider may overestimate novelty.

3. **Rhetorical value not captured:** ISDA measures semantic content, not persuasive effectiveness. A text may be "compressible" in information terms yet valuable for its rhetorical form, emotional resonance, or aesthetic qualities.

4. **Assumes semantic reconstruction goal:** ISDA asks whether *meaning* can be preserved under compression. If the goal is exact reproduction (e.g., legal documents), use literal Kolmogorov complexity instead.

5. **Interdependencies:** S₄ decisions may not be independent; the calculation log₂(|space|) for each decision and summing may undercount or overcount total decision complexity.

6. **Dynamic knowledge bases:** What counts as "retrievable" (S₂) depends on assumed access. Specify the reference frame (e.g., "accessible via standard academic databases" or "common knowledge for a graduate student in field X").

---

## Version History

**ISDA v1.0**  
Initial release. Developed for structured complexity analysis of scholarly, argumentative, and expository texts.

---

## Quick Reference Card

```
ISDA: Irreducible Semantic Density Analysis

STRATA:
S₁ = Structure (architecture, templates)
S₂ = Retrievable (quotations, facts, definitions)  
S₃ = Derived (standard inferences from S₂)
S₄ = Curatorial (selection, arrangement, emphasis)
S₅ = Novel (irreducible original content)

METRICS:
SCR = Raw / Compressed     [<2 dense, 2-5 good, 5-10 expansive, >10 bloated]
ND  = S₅ / Raw             [>0.10 original, 0.05-0.10 solid, <0.05 derivative]  
RI  = (S₂+S₃) / Raw        [higher = more source-dependent]
CBAT = S₅ < 280 chars?     [YES = core fits tweet, NO = inherently complex]

PROCESS:
1. Measure raw length
2. Encode structure (S₁)
3. Replace retrievables with pointers (S₂)
4. Encode inferences as method+input (S₃)
5. Enumerate decisions with choice-space bits (S₄)
6. Extract novel content verbatim (S₅)
7. Compute metrics
8. Interpret against genre expectations
```
