import math
import numpy as np

def assign_thesis_attributes(items, seed=42):
    """
    Ensures all items have 'weight', 'LBS', 'fragile', and 'stop' attributes.
    This simulates the dataset augmentation described in the thesis.
    """
    rng = np.random.default_rng(seed)
    
    # 1. Ensure weight exists
    for i, item in enumerate(items):
        if 'weight' not in item:
            item['weight'] = rng.integers(1, 21)
            
        if 'LBS' not in item and 'lbs' not in item and 'LoadBearingStrength' not in item:
            vol = item['L'] * item['H'] * item['D']
            item['LBS'] = item['weight'] + rng.integers(10, 50) + (vol / 10000)
        else:
            item['LBS'] = float(item.get('LBS', item.get('lbs', item.get('LoadBearingStrength'))))
            
    # 2. Fragility Class Assignment (Q1 Threshold)
    lbs_values = [item['LBS'] for item in items]
    q1 = np.percentile(lbs_values, 25)
    
    for item in items:
        if item['LBS'] <= q1:
            item['fragile'] = 1
        else:
            item['fragile'] = 0
            
    # 3. 3-Stop Uniform Assignment (+- 10% balance)
    # Assign stops 1, 2, 3 evenly across the items
    n_items = len(items)
    stops = [1, 2, 3] * (n_items // 3 + 1)
    stops = stops[:n_items]
    rng.shuffle(stops)
    
    for i, item in enumerate(items):
        item['stop'] = stops[i]

def _overlap(a0, a1, b0, b1):
    return max(0, min(a1, b1) - max(a0, b0))

def _is_above(i, j, placements):
    """
    Returns True if box j is 'above' box i.
    In the codebase: y is vertical, z is depth, x is length.
    j is above i if y_j >= y_i + h_i AND they overlap in x-z projection.
    """
    (_, x_i, y_i, z_i, l_i, h_i, d_i) = placements[i]
    (_, x_j, y_j, z_j, l_j, h_j, d_j) = placements[j]
    
    if y_j >= y_i + h_i:
        ox = _overlap(x_i, x_i + l_i, x_j, x_j + l_j)
        oz = _overlap(z_i, z_i + d_i, z_j, z_j + d_j)
        if ox > 0 and oz > 0:
            return True
    return False

def _blocks_extraction(i, j, placements):
    """
    Returns True if box j physically blocks the extraction of box i from the container.
    
    METHODOLOGY SYNCHRONIZATION (Chapter 3):
    The thesis defines the removal corridor along the Y-axis with the front face opening 
    at y=0. Therefore, to remove box i, it must be translated toward y=0 (i.e. -Y direction).
    Box j blocks box i if j is located between i and the door (y_j <= y_i) AND their 
    projections overlap in the X-Z plane.
    """
    (_, x_i, y_i, z_i, l_i, h_i, d_i) = placements[i]
    (_, x_j, y_j, z_j, l_j, h_j, d_j) = placements[j]
    
    # Thesis: front face at y=0, unloading towards -Y
    if y_j <= y_i:
        ox = _overlap(x_i, x_i + l_i, x_j, x_j + l_j)
        oz = _overlap(z_i, z_i + d_i, z_j, z_j + d_j)
        if ox > 0 and oz > 0:
            return True
    return False

def space_utilization(placements, container, n_bins):
    if n_bins == 0:
        return 0.0
    packed_vol = sum(p[4] * p[5] * p[6] for p in placements.values())
    cap = n_bins * container['L'] * container['H'] * container['D']
    return (packed_vol / cap) * 100.0 if cap > 0 else 0.0

def evaluate_constraints(placements, items):
    """
    Evaluates C3 (Weight/LBS), C4 (Fragility), C5 (Balance), C6 (Stop-Order).
    Returns S(X) and detail dictionary.
    """
    total = len(placements)
    if total == 0:
        return 0.0, {
            "C3_weight_pct": 0.0,
            "C4_fragility_pct": 0.0,
            "C5_balance_pct": 0.0,
            "C6_stop_order_pct": 0.0,
            "total_compliant_pct": 0.0
        }
    
    # Group by bin to limit comparisons
    per_bin = {}
    for i, p in placements.items():
        b = p[0]
        per_bin.setdefault(b, []).append(i)
        
    c3_ok = 0
    c4_ok = 0
    c5_ok = 0
    c6_ok = 0
    all_ok = 0
    
    for b, members in per_bin.items():
        for i in members:
            # Gather boxes above i
            boxes_above = [j for j in members if i != j and _is_above(i, j, placements)]
            
            # C3: Weight Capacity (LBS)
            # The sum of weights of all boxes directly or indirectly above i must be <= LBS_i
            cumulative_weight = sum(items[j].get('weight', 1) for j in boxes_above)
            is_c3_ok = cumulative_weight <= items[i].get('LBS', float('inf'))
            
            # C4: Fragility
            # If f_i == 1, no boxes can be above it
            is_c4_ok = not (items[i].get('fragile', 0) == 1 and len(boxes_above) > 0)
            
            # C5: Balance (80% base support)
            (_, x_i, y_i, z_i, l_i, h_i, d_i) = placements[i]
            if y_i == 0:
                is_c5_ok = True
            else:
                supported_area = 0.0
                for j in members:
                    if i != j:
                        (_, x_j, y_j, z_j, l_j, h_j, d_j) = placements[j]
                        if abs((y_j + h_j) - y_i) < 1e-5: # j is directly under i
                            ox = _overlap(x_i, x_i + l_i, x_j, x_j + l_j)
                            oz = _overlap(z_i, z_i + d_i, z_j, z_j + d_j)
                            supported_area += ox * oz
                base_area = l_i * d_i
                is_c5_ok = (supported_area / base_area) >= 0.80 if base_area > 0 else False
                
            # C6: Stop-Order Accessibility
            # No box j blocking i can have a later stop (s_j > s_i)
            is_c6_ok = True
            s_i = items[i].get('stop', 1)
            for j in members:
                if i != j and _blocks_extraction(i, j, placements) and items[j].get('stop', 1) > s_i:
                    is_c6_ok = False
                    break
            
            # Tally
            if is_c3_ok: c3_ok += 1
            if is_c4_ok: c4_ok += 1
            if is_c5_ok: c5_ok += 1
            if is_c6_ok: c6_ok += 1
            if is_c3_ok and is_c4_ok and is_c5_ok and is_c6_ok:
                all_ok += 1

    detail = {
        "C3_weight_pct": (c3_ok / total) * 100.0,
        "C4_fragility_pct": (c4_ok / total) * 100.0,
        "C5_balance_pct": (c5_ok / total) * 100.0,
        "C6_stop_order_pct": (c6_ok / total) * 100.0,
        "total_compliant_pct": (all_ok / total) * 100.0
    }
    
    return detail["total_compliant_pct"], detail

def robustness(su_values):
    n = len(su_values)
    if n < 2:
        return 0.0
    mean = sum(su_values) / n
    var = sum((v - mean) ** 2 for v in su_values) / (n - 1)
    return math.sqrt(var)
