# HANDOFF NOTE — Data Mining Activity (Real Results)

## What this is
Our data mining document currently has "projected" numbers taken from the
Kosari et al. paper, NOT from actually running our code. The professor wants
REAL results from running our baseline model. This script produces those real
numbers automatically.

Our real HD-GWO baseline already works well (it hit optimal on test runs), so
there is no downside — the real numbers are good.


## What you need to do (about 15 minutes)

### Step 1 — Put the script in the right folder
Copy `run_datamining.py` into:
    D:\dev\3d-bin-packing\optimizer\

(It sits next to instance_reader.py and baseline_2d.py, which it needs.)


### Step 2 — Open a terminal in that folder
In VS Code: open the project, press Ctrl+` (backtick) to open the terminal.
Then type:
    cd D:\dev\3d-bin-packing\optimizer


### Step 3 — Run the script
Type this one line and press Enter:

    python run_datamining.py --set BR0 --count 10 --max-time 30 --out results.txt

It will:
  - run our REAL HD-GWO baseline on 10 instances
  - run S-FFD (the greedy comparator) on the same 10
  - print a results table
  - save everything to a file called results.txt in the same folder

It takes a few minutes. You'll see progress lines like:
    [1/10] 1.json: HD-GWO 2 bins / 99.8%  |  S-FFD 3 bins / 66.5%


### Step 4 — Copy the numbers into the document
Open results.txt. You'll see two sections:

  1. A RESULTS TABLE  -> replace the fake table on page 5 of our document
                         (the columns match: Active Bins, VUR %, Cost Score,
                          Constraint Violations)

  2. A COMPARISON SUMMARY -> use these for the "Comparison Against Greedy
                             Baseline" section on page 7 (the bullet points
                             about % fewer bins, VUR improvement, etc.)

Just swap our real numbers in place of the projected ones. Done.


## Important note for the writeup
Change the dataset wording slightly. Our document says we used OR-Library
.txt files (BR1, BR3, BR5, thpack7). What we ACTUALLY ran is the JSON-format
Bischoff-Ratcliff (BR) instances from CLP-Datasets-Main (BR0, etc.).

These are the SAME benchmark family (Bischoff-Ratcliff is part of OR-Library),
just a different file format. So either:
  - say we used the JSON-formatted BR instances, OR
  - keep OR-Library wording but note the BR instances were used

Whichever the group prefers — just make the document match what we actually ran.


## If something breaks
- "folder not found"  -> the BR data isn't at data\CLP-Datasets-Main\BR\.
                         Check that the dataset was copied over.
- "No module named..." -> run_datamining.py isn't in the optimizer folder
                         next to baseline_2d.py and instance_reader.py.
- It hangs on a big instance -> add  --count 5  to run fewer, or lower
                         --max-time to 15.

That's it. Run it, copy the real numbers in, and the submission is genuine.
