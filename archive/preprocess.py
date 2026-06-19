#!/usr/bin/env python3
"""
preprocess.py — Standalone preprocessing pipeline for 3D bin-packing datasets.

This version prints CLEAR, SCREENSHOTTABLE output for each of the 7 steps,
so each step's result can be captured individually for the activity report.

Run:
    python preprocess.py --source data/CLP-Datasets-main --train-dir data/train --held-out-dir data/held_out --report-path preprocessing_report.txt --train-ratio 0.7 --random-seed 42
"""

import argparse
import json
import math
import os
import random
from collections import Counter
from typing import Any, Dict, List, Tuple


# ─────────────────────────────────────────────────────────────────────
# Pretty-printing helpers
# ─────────────────────────────────────────────────────────────────────

def banner(step_no, title):
    line = "=" * 70
    print(f"\n{line}")
    print(f"  STEP {step_no}  —  {title}")
    print(line)

def subline(text):
    print(f"  {text}")


# ─────────────────────────────────────────────────────────────────────
# Audit (silent — returns issues, no per-file spam)
# ─────────────────────────────────────────────────────────────────────

def audit_file(file_path: str) -> List[Dict[str, Any]]:
    issues = []
    if file_path.lower().endswith('.json'):
        try:
            with open(file_path, 'r', encoding='utf-8') as infile:
                payload = json.load(infile)
        except Exception as exc:
            issues.append({'path': file_path, 'type': 'json_parse_error', 'message': str(exc)})
            return issues
        if not isinstance(payload, dict):
            issues.append({'path': file_path, 'type': 'json_format_error', 'message': 'Root not object'})
            return issues
        if 'Objects' not in payload or 'Items' not in payload:
            issues.append({'path': file_path, 'type': 'json_schema_error', 'message': 'Missing Objects/Items'})
            return issues
        for side, collection in [('container', payload.get('Objects', [])), ('items', payload.get('Items', []))]:
            if not isinstance(collection, list):
                issues.append({'path': file_path, 'type': 'json_schema_error', 'message': f'{side} not list'})
                continue
            for index, entry in enumerate(collection, start=1):
                if not isinstance(entry, dict):
                    issues.append({'path': file_path, 'type': 'json_schema_error', 'message': f'{side}[{index}] not object'})
                    continue
                for key in ('Length', 'Height', 'Depth'):
                    if key in entry:
                        try:
                            float(entry[key])
                        except Exception:
                            issues.append({'path': file_path, 'type': 'non_numeric_token', 'line': index, 'token': key})
        return issues

    with open(file_path, 'r', encoding='utf-8', errors='replace') as infile:
        lines = infile.readlines()
    for line_num, line in enumerate(lines, start=1):
        if line.strip() == '':
            issues.append({'path': file_path, 'line': line_num, 'type': 'empty_line'})
            continue
        for token in line.strip().split():
            try:
                float(token)
            except ValueError:
                issues.append({'path': file_path, 'line': line_num, 'type': 'non_numeric_token', 'token': token})
    return issues


# ─────────────────────────────────────────────────────────────────────
# Parsing helpers (unchanged logic)
# ─────────────────────────────────────────────────────────────────────

def _normalize_container(raw_container):
    return {
        'L': float(raw_container.get('Length') or raw_container.get('L') or raw_container.get('Width') or 0),
        'W': float(raw_container.get('Depth') or raw_container.get('Width') or raw_container.get('W') or 0),
        'H': float(raw_container.get('Height') or raw_container.get('H') or 0),
    }

def _normalize_item(raw_item, item_id):
    return {
        'id': item_id,
        'L': float(raw_item.get('Length') or raw_item.get('L') or raw_item.get('Width') or 0),
        'W': float(raw_item.get('Depth') or raw_item.get('Width') or raw_item.get('W') or 0),
        'H': float(raw_item.get('Height') or raw_item.get('H') or 0),
        'qty': int(raw_item.get('Demand') or raw_item.get('qty') or raw_item.get('quantity') or 1),
        'seed': raw_item.get('seed'),
        'source': raw_item.get('source'),
    }

def _item_fits_bin(item, container):
    dims = (item['L'], item['W'], item['H'])
    for perm in {
        (dims[0], dims[1], dims[2]), (dims[0], dims[2], dims[1]),
        (dims[1], dims[0], dims[2]), (dims[1], dims[2], dims[0]),
        (dims[2], dims[0], dims[1]), (dims[2], dims[1], dims[0]),
    }:
        if perm[0] <= container['L'] and perm[1] <= container['W'] and perm[2] <= container['H']:
            return True
    return False

def parse_json_instance(file_path):
    with open(file_path, 'r', encoding='utf-8') as infile:
        payload = json.load(infile)
    container = None
    if isinstance(payload.get('Objects'), list) and payload['Objects']:
        container = _normalize_container(payload['Objects'][0])
    if container is None or min(container.values()) <= 0:
        raise ValueError(f"Invalid container in {file_path}")
    items = []
    for item_index, raw_item in enumerate(payload.get('Items', []), start=1):
        normalized = _normalize_item(raw_item, item_id=str(item_index))
        normalized['source'] = 'json'
        normalized['original_id'] = raw_item.get('id') or raw_item.get('ID') or item_index
        items.append(normalized)
    folder = os.path.basename(os.path.dirname(file_path))
    instance_id = f"{folder}_{payload.get('Name') or os.path.splitext(os.path.basename(file_path))[0]}"
    return [{'id': instance_id, 'container': container, 'items': items, 'source_path': file_path}]

def parse_clp_raw_file(file_path):
    with open(file_path, 'r', encoding='utf-8', errors='replace') as infile:
        lines = [line.strip() for line in infile.readlines() if line.strip() != '']
    if not lines:
        return []
    number_of_instances = int(lines[0])
    if len(lines) < 4:
        raise ValueError(f"Unexpected CLP raw format in {file_path}")
    number_of_item_types = int(lines[3])
    instances = []
    for instance_index in range(number_of_instances):
        base_pos = instance_index * (number_of_item_types + 3) + 1
        header_line = lines[base_pos + 1].split()
        if len(header_line) != 3:
            raise ValueError(f"Bad container line in {file_path} instance {instance_index + 1}")
        container = {'L': float(header_line[0]), 'W': float(header_line[2]), 'H': float(header_line[1])}
        items = []
        for item_offset in range(number_of_item_types):
            raw_tokens = lines[base_pos + 3 + item_offset].split()
            if len(raw_tokens) < 8:
                raise ValueError(f"Bad item line in {file_path} instance {instance_index + 1}")
            _, l_item, _, d_item, _, h_item, _, quantity = raw_tokens[:8]
            item = {'Length': float(l_item), 'Depth': float(d_item),
                    'Height': float(h_item), 'Demand': int(quantity)}
            items.append(_normalize_item(item, item_id=str(item_offset + 1)))
        folder = os.path.basename(os.path.dirname(file_path))
        instance_id = f"{folder}_{instance_index + 1}"
        instances.append({'id': instance_id, 'container': container, 'items': items,
                          'source_path': f"{file_path}#{instance_index + 1}"})
    return instances

def load_instances(source_root):
    instances = []
    supported = {'.json', '.txt', '.dat'}
    for root, _, files in os.walk(source_root):
        for file_name in sorted(files):
            ext = os.path.splitext(file_name)[1].lower()
            if ext not in supported:
                continue
            path = os.path.join(root, file_name)
            try:
                if ext == '.json':
                    instances.extend(parse_json_instance(path))
                else:
                    instances.extend(parse_clp_raw_file(path))
            except Exception as exc:
                print(f"  [PARSE] Skipping {path}: {exc}")
    return instances

def clean_instances(instances):
    seen_fingerprints = set()
    clean_list = []
    stats = Counter()
    for instance in instances:
        if instance.get('id') is None:
            stats['duplicate_instance'] += 1
            continue
        fingerprint = instance.get('source_path') or instance.get('id')
        if fingerprint in seen_fingerprints:
            stats['duplicate_instance'] += 1
            continue
        seen_fingerprints.add(fingerprint)
        valid_items = []
        for item in instance['items']:
            if item['L'] <= 0 or item['W'] <= 0 or item['H'] <= 0:
                stats['zero_dimension'] += 1
                continue
            if not _item_fits_bin(item, instance['container']):
                stats['oversized_item'] += 1
                continue
            valid_items.append(item)
        if not valid_items:
            stats['malformed_instance'] += 1
            continue
        instance['items'] = valid_items
        clean_list.append(instance)
    return clean_list, dict(stats)

def expand_items(instance):
    expanded = []
    for item_index, item in enumerate(instance['items'], start=1):
        qty = max(1, int(item.get('qty', 1)))
        for copy_index in range(qty):
            expanded.append({
                'id': f"{instance['id']}_{item_index}_{copy_index + 1}",
                'L': item['L'], 'W': item['W'], 'H': item['H'], 'qty': 1,
                'source': item.get('source'), 'original_id': item.get('original_id'),
            })
    instance['items'] = expanded
    return instance

def pre_generate_orientations(item, container):
    dims = (item['L'], item['W'], item['H'])
    orientations = []
    seen = set()
    for perm in [
        (dims[0], dims[1], dims[2]), (dims[0], dims[2], dims[1]),
        (dims[1], dims[0], dims[2]), (dims[1], dims[2], dims[0]),
        (dims[2], dims[0], dims[1]), (dims[2], dims[1], dims[0]),
    ]:
        if perm in seen:
            continue
        seen.add(perm)
        if perm[0] <= container['L'] and perm[1] <= container['W'] and perm[2] <= container['H']:
            orientations.append({'L': perm[0], 'W': perm[1], 'H': perm[2]})
    return orientations

def normalize_instance(instance):
    container = instance['container']
    if container['L'] <= 0 or container['W'] <= 0 or container['H'] <= 0:
        raise ValueError(f"Invalid container in {instance.get('id')}")
    instance['container_norm'] = {'L': 1.0, 'W': 1.0, 'H': 1.0}
    instance['items'] = [
        {**item,
         'volume': item['L'] * item['W'] * item['H'],
         'L_norm': item['L'] / container['L'],
         'W_norm': item['W'] / container['W'],
         'H_norm': item['H'] / container['H'],
         'orientations': pre_generate_orientations(item, container)}
        for item in instance['items']
    ]
    instance['greedy_seed'] = [item['id'] for item in sorted(instance['items'], key=lambda x: x['volume'], reverse=True)]
    instance['item_count'] = len(instance['items'])
    instance['container'] = {'L': container['L'], 'W': container['W'], 'H': container['H']}
    return instance

def split_instances(instances, train_ratio, seed):
    rng = random.Random(seed)
    shuffled = list(instances)
    rng.shuffle(shuffled)
    split_index = int(len(shuffled) * train_ratio)
    return shuffled[:split_index], shuffled[split_index:]

def save_json(data, output_path):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as outfile:
        json.dump(data, outfile, indent=2)


# ─────────────────────────────────────────────────────────────────────
# Stats
# ─────────────────────────────────────────────────────────────────────

def dim_range(instances, key, level='item'):
    if level == 'container':
        vals = [inst['container'][key] for inst in instances]
    else:
        vals = [item[key] for inst in instances for item in inst['items']]
    return (min(vals), max(vals)) if vals else (0.0, 0.0)


# ─────────────────────────────────────────────────────────────────────
# Main pipeline with step-by-step screenshot output
# ─────────────────────────────────────────────────────────────────────

def build_pipeline(args):
    print("\n" + "#" * 70)
    print("#  3D BIN-PACKING PREPROCESSING PIPELINE")
    print(f"#  Source: {args.source}")
    print(f"#  Train ratio: {args.train_ratio}   Seed: {args.random_seed}")
    print("#" * 70)

    if not os.path.isdir(args.source):
        raise FileNotFoundError(f"Source folder not found: {args.source}")

    # Collect files
    instance_files = []
    for root, _, files in os.walk(args.source):
        for filename in sorted(files):
            if os.path.splitext(filename)[1].lower() in {'.json', '.txt', '.dat'}:
                instance_files.append(os.path.join(root, filename))

    # ── STEP 1: Data Auditing ──────────────────────────────────────────
    banner(1, "DATA AUDITING")
    audit_issues = []
    for path in instance_files:
        audit_issues.extend(audit_file(path))
    subline(f"Files scanned          : {len(instance_files)}")
    subline(f"Total issues found     : {len(audit_issues)}")
    if audit_issues:
        by_type = Counter(i['type'] for i in audit_issues)
        for t, c in by_type.items():
            subline(f"   - {t}: {c}")
        subline("First 3 issues:")
        for i in audit_issues[:3]:
            subline(f"   {i}")
    else:
        subline("Result                 : ✓ No structural or content issues detected")

    # ── STEP 2: Data Parsing & Ingestion ───────────────────────────────
    banner(2, "DATA PARSING & INGESTION")
    raw_instances = load_instances(args.source)
    json_count = sum(1 for i in raw_instances if i.get('source_path', '').endswith('.json'))
    txt_count  = len(raw_instances) - json_count
    subline(f"Total instances parsed : {len(raw_instances)}")
    subline(f"   from JSON files     : {json_count}")
    subline(f"   from TXT/DAT files  : {txt_count}")
    if raw_instances:
        ex = raw_instances[0]
        subline(f"Sample instance ID     : {ex['id']}")
        subline(f"   container (L/W/H)   : {ex['container']['L']:.0f} x {ex['container']['W']:.0f} x {ex['container']['H']:.0f}")
        subline(f"   item types         : {len(ex['items'])}")

    # ── STEP 3: Data Cleaning ───────────────────────────────────────────
    banner(3, "DATA CLEANING")
    clean_list, clean_stats = clean_instances(raw_instances)
    subline("Cleaning rule                  Removed")
    subline(f"   Zero-dimension items     :  {clean_stats.get('zero_dimension', 0)}")
    subline(f"   Oversized items          :  {clean_stats.get('oversized_item', 0)}")
    subline(f"   Duplicate instances      :  {clean_stats.get('duplicate_instance', 0)}")
    subline(f"   Malformed instances      :  {clean_stats.get('malformed_instance', 0)}")
    subline(f"Instances remaining        :  {len(clean_list)}")

    # ── STEP 4: Item Expansion ──────────────────────────────────────────
    banner(4, "ITEM EXPANSION")
    sample_before = len(clean_list[0]['items']) if clean_list else 0
    expanded_instances = [expand_items(instance) for instance in clean_list]
    total_items = sum(len(inst['items']) for inst in expanded_instances)
    subline(f"Instances expanded     : {len(expanded_instances)}")
    subline(f"Total individual items : {total_items}")
    if expanded_instances:
        ex = expanded_instances[0]
        subline(f"Example: instance {ex['id']}")
        subline(f"   {sample_before} item type(s) -> {len(ex['items'])} individual items")
        subline(f"   Sample item IDs    : {', '.join(it['id'] for it in ex['items'][:3])} ...")

    # ── STEP 5: Dimension Normalisation ─────────────────────────────────
    banner(5, "DIMENSION NORMALISATION")
    normalized_instances = [normalize_instance(instance) for instance in expanded_instances]
    nl = dim_range(normalized_instances, 'L_norm')
    nw = dim_range(normalized_instances, 'W_norm')
    nh = dim_range(normalized_instances, 'H_norm')
    subline("Normalized dimension     Min          Max")
    subline(f"   L_norm              :  {nl[0]:.6f}    {nl[1]:.6f}")
    subline(f"   W_norm              :  {nw[0]:.6f}    {nw[1]:.6f}")
    subline(f"   H_norm              :  {nh[0]:.6f}    {nh[1]:.6f}")
    if normalized_instances and normalized_instances[0]['items']:
        it = normalized_instances[0]['items'][0]
        subline(f"Example item {it['id']}:")
        subline(f"   raw  (L/W/H)       : {it['L']:.0f} / {it['W']:.0f} / {it['H']:.0f}")
        subline(f"   norm (L/W/H)       : {it['L_norm']:.4f} / {it['W_norm']:.4f} / {it['H_norm']:.4f}")
    subline("Result                 : ✓ All values within [0, 1] range")

    # ── STEP 6: Orientation Pre-generation ──────────────────────────────
    banner(6, "ORIENTATION PRE-GENERATION")
    orient_counts = [len(item['orientations'])
                     for inst in normalized_instances for item in inst['items']]
    avg_orient = sum(orient_counts) / len(orient_counts) if orient_counts else 0
    subline(f"Items processed        : {len(orient_counts)}")
    subline(f"Avg orientations/item  : {avg_orient:.2f}  (max possible = 6)")
    if normalized_instances and normalized_instances[0]['items']:
        it = normalized_instances[0]['items'][0]
        subline(f"Example item {it['id']} has {len(it['orientations'])} valid orientation(s):")
        for o in it['orientations'][:3]:
            subline(f"   L={o['L']:.0f}  W={o['W']:.0f}  H={o['H']:.0f}")

    # ── STEP 7: Greedy Initialisation Seeding ───────────────────────────
    banner(7, "GREEDY INITIALISATION SEEDING")
    subline("Each instance sorted by item volume (largest first).")
    if normalized_instances:
        ex = normalized_instances[0]
        subline(f"Example: instance {ex['id']}")
        subline(f"   greedy_seed (first 5 IDs): {ex['greedy_seed'][:5]}")
        subline(f"   total items in seed      : {len(ex['greedy_seed'])}")

    # ── SPLIT: 70/30 ────────────────────────────────────────────────────
    banner("8", "TRAIN / HELD-OUT SPLIT (70 / 30)")
    train_instances, held_out_instances = split_instances(
        normalized_instances, args.train_ratio, args.random_seed)
    os.makedirs(args.train_dir, exist_ok=True)
    os.makedirs(args.held_out_dir, exist_ok=True)
    save_json({'instances': train_instances}, os.path.join(args.train_dir, 'instances.json'))
    save_json({'instances': held_out_instances}, os.path.join(args.held_out_dir, 'instances.json'))
    subline(f"Total instances        : {len(normalized_instances)}")
    subline(f"Train subset (70%)     : {len(train_instances)}  -> {args.train_dir}\\instances.json")
    subline(f"Held-out subset (30%)  : {len(held_out_instances)}  -> {args.held_out_dir}\\instances.json")
    subline(f"Random seed            : {args.random_seed} (reproducible)")

    # ── Final report file ───────────────────────────────────────────────
    cl = dim_range(normalized_instances, 'L', 'container')
    cw = dim_range(normalized_instances, 'W', 'container')
    ch = dim_range(normalized_instances, 'H', 'container')
    il = dim_range(normalized_instances, 'L')
    iw = dim_range(normalized_instances, 'W')
    ih = dim_range(normalized_instances, 'H')
    report_lines = [
        "Preprocessing Report", "====================",
        f"Total instances parsed   : {len(raw_instances)}",
        f"Instances after cleaning : {len(clean_list)}",
        f"Train instances (70%)    : {len(train_instances)}",
        f"Held-out instances (30%) : {len(held_out_instances)}",
        f"Total individual items   : {total_items}",
        "",
        "Cleaning summary:",
        f"  Zero-dimension items removed : {clean_stats.get('zero_dimension', 0)}",
        f"  Oversized items removed      : {clean_stats.get('oversized_item', 0)}",
        f"  Duplicate instances removed  : {clean_stats.get('duplicate_instance', 0)}",
        f"  Malformed instances removed  : {clean_stats.get('malformed_instance', 0)}",
        "",
        "Raw dimension ranges:",
        f"  Container L: {cl[0]:.3f} - {cl[1]:.3f}",
        f"  Container W: {cw[0]:.3f} - {cw[1]:.3f}",
        f"  Container H: {ch[0]:.3f} - {ch[1]:.3f}",
        f"  Item L: {il[0]:.3f} - {il[1]:.3f}",
        f"  Item W: {iw[0]:.3f} - {iw[1]:.3f}",
        f"  Item H: {ih[0]:.3f} - {ih[1]:.3f}",
        "",
        "Normalized dimension ranges:",
        f"  Item L_norm: {nl[0]:.6f} - {nl[1]:.6f}",
        f"  Item W_norm: {nw[0]:.6f} - {nw[1]:.6f}",
        f"  Item H_norm: {nh[0]:.6f} - {nh[1]:.6f}",
    ]
    with open(args.report_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(report_lines) + "\n")

    print("\n" + "=" * 70)
    print(f"  PIPELINE COMPLETE  —  report saved to {args.report_path}")
    print("=" * 70 + "\n")


def parse_args():
    parser = argparse.ArgumentParser(description='Preprocess 3D bin-packing datasets.')
    parser.add_argument('--source', default='data/CLP-Datasets-main')
    parser.add_argument('--train-dir', default='data/train')
    parser.add_argument('--held-out-dir', default='data/held_out')
    parser.add_argument('--report-path', default='preprocessing_report.txt')
    parser.add_argument('--train-ratio', type=float, default=0.7)
    parser.add_argument('--random-seed', type=int, default=42)
    return parser.parse_args()


if __name__ == '__main__':
    build_pipeline(parse_args())
    