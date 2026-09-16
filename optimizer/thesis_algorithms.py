import math
import random
import time
import sys
import numpy as np

from thesis_math import decode_position
from thesis_metrics import assign_thesis_attributes, evaluate_constraints, space_utilization
from geometry_3d import place_bin_dblf, get_dims

class WolfContinuous:
    def __init__(self, n, lambda_penalty=1000.0):
        self.n = n
        self.lambda_penalty = lambda_penalty
        # [r_1..r_n, x_1..x_n, y_1..y_n, z_1..z_n]
        self.X = np.random.uniform(-5, 5, 4 * n)
        
        # Phenotype
        self.placements = {}
        self.n_bins = 0
        
        # Fitness / Metrics
        self.su = 0.0
        self.csr = 0.0
        self.scalar_fitness = float('inf')
        
    def decode_and_evaluate(self, items, container, apply_repair=False):
        """
        Decodes X into discrete placements using DBLF and evaluates fitness.
        If apply_repair is True, applies heuristic repair logic before evaluation.
        """
        # 1. Decode continuous X to target discrete coordinates
        discrete_targets = decode_position(self.X, items, container)
        
        # 2. Sort items based on target Z, then Y, then X to feed into DBLF
        sorted_items = sorted(discrete_targets, key=lambda t: (t['z'], t['y'], t['x']))
        sequence = [t['item_idx'] for t in sorted_items]
        
        # We also pass the decoded orientations to DBLF
        orients_map = {t['item_idx']: t['r'] for t in discrete_targets}
        
        # 3. DBLF Placement to guarantee C1 and C2
        unpacked = sequence[:]
        self.placements = {}
        bin_id = 0
        
        while unpacked:
            bin_placements, overflow = place_bin_dblf(unpacked, items, orients_map, container)
            
            for item_idx, (ex, ey, ez, l, h, d) in bin_placements.items():
                self.placements[item_idx] = (bin_id, ex, ey, ez, l, h, d)
                
            unpacked = overflow
            bin_id += 1
            
        self.n_bins = bin_id
        
        # 4. (Optional) Repair R1-R5
        if apply_repair:
            self._repair(items, container)
            
        # 5. Evaluate U(X) and S(X)
        self.su = space_utilization(self.placements, container, self.n_bins)
        self.csr, detail = evaluate_constraints(self.placements, items)
        
        # 6. Scalar Fitness F(X) for DGWO
        v_w = 100.0 - detail['C3_weight_pct']
        v_f = 100.0 - detail['C4_fragility_pct']
        v_b = 100.0 - detail['C5_balance_pct']
        v_a = 100.0 - detail['C6_stop_order_pct']
        
        penalty = self.lambda_penalty * (v_w + v_f + v_b + v_a)
        
        self.scalar_fitness = (self.n_bins * 1000) - self.su + penalty

    def _repair(self, items, container):
        """
        Executes up to R_max = 3 sequential repair passes (R1-R4) to restore constraint 
        compliance. Enforces feasibility by removing any remaining violators.
        """
        from thesis_metrics import _is_above, _blocks_extraction
        R_max = 3
        
        for r_pass in range(R_max):
            violating_items = set()
            
            # Identify current state
            per_bin = {}
            for i, p in self.placements.items():
                b = p[0]
                per_bin.setdefault(b, []).append(i)
                
            for b, members in per_bin.items():
                for i in members:
                    boxes_above = [j for j in members if i != j and _is_above(i, j, self.placements)]
                    
                    # R1 (Fragility): Remove items stacked above fragile boxes
                    if items[i].get('fragile', 0) == 1 and len(boxes_above) > 0:
                        violating_items.update(boxes_above)
                        
                    # R2 (Weight): Remove items if cumulative mass > LBS
                    cumulative_weight = sum(items[j].get('weight', 1) for j in boxes_above)
                    if cumulative_weight > items[i].get('LBS', float('inf')):
                        # Sort boxes_above by mass descending to remove heaviest first
                        boxes_above.sort(key=lambda j: items[j].get('weight', 1), reverse=True)
                        removed_weight = 0
                        for j in boxes_above:
                            violating_items.add(j)
                            removed_weight += items[j].get('weight', 1)
                            if cumulative_weight - removed_weight <= items[i].get('LBS', float('inf')):
                                break
                                
                    # R3 (Balance): Non-floor boxes failing 80% support threshold
                    (_, x_i, y_i, z_i, l_i, h_i, d_i) = self.placements[i]
                    if y_i > 0:
                        supported_area = 0.0
                        from thesis_metrics import _overlap
                        for j in members:
                            if i != j:
                                (_, x_j, y_j, z_j, l_j, h_j, d_j) = self.placements[j]
                                if abs((y_j + h_j) - y_i) < 1e-5:
                                    ox = _overlap(x_i, x_i + l_i, x_j, x_j + l_j)
                                    oz = _overlap(z_i, z_i + d_i, z_j, z_j + d_j)
                                    supported_area += ox * oz
                        base_area = l_i * d_i
                        if base_area > 0 and (supported_area / base_area) < 0.80:
                            violating_items.add(i)
                            
                    # R4 (Stop-Order): Items blocked by later-stop boxes
                    s_i = items[i].get('stop', 1)
                    for j in members:
                        if i != j and _blocks_extraction(i, j, self.placements) and items[j].get('stop', 1) > s_i:
                            violating_items.add(j) # Remove blocking item
                            
            if not violating_items:
                break
                
            # Defer to unpacked list (remove from packed set I_p)
            for v in violating_items:
                if v in self.placements:
                    del self.placements[v]
                    
        # Force re-evaluation of SU and CSR post-repair to guarantee S(X) = 1.0
        self.su = space_utilization(self.placements, container, self.n_bins)
        self.csr, _ = evaluate_constraints(self.placements, items)

    def dominates(self, other):
        """Pareto dominance: True if self dominates other based on SU and CSR (MOGWO-1)."""
        better_or_eq = (self.su >= other.su) and (self.csr >= other.csr)
        strictly_better = (self.su > other.su) or (self.csr > other.csr)
        return better_or_eq and strictly_better


def _update_position(wolf, alpha, beta, delta, a):
    n_dim = len(wolf.X)
    new_X = np.zeros(n_dim)
    
    for i in range(n_dim):
        # Alpha
        r1, r2 = random.random(), random.random()
        A1 = 2 * a * r1 - a
        C1 = 2 * r2
        D_alpha = abs(C1 * alpha.X[i] - wolf.X[i])
        X1 = alpha.X[i] - A1 * D_alpha
        
        # Beta
        r1, r2 = random.random(), random.random()
        A2 = 2 * a * r1 - a
        C2 = 2 * r2
        D_beta = abs(C2 * beta.X[i] - wolf.X[i])
        X2 = beta.X[i] - A2 * D_beta
        
        # Delta
        r1, r2 = random.random(), random.random()
        A3 = 2 * a * r1 - a
        C3 = 2 * r2
        D_delta = abs(C3 * delta.X[i] - wolf.X[i])
        X3 = delta.X[i] - A3 * D_delta
        
        new_X[i] = (X1 + X2 + X3) / 3.0
        
    # Clip to bounds [-5, 5]
    wolf.X = np.clip(new_X, -5, 5)


class ThesisOptimizerBase:
    def __init__(self, items, container, pop_size=30, max_iter=500, max_time=90, lambda_penalty=1000.0, stream_cb=None):
        self.items = items
        self.container = container
        self.pop_size = pop_size
        self.max_iter = max_iter
        self.max_time = max_time
        self.lambda_penalty = lambda_penalty
        self.stream_cb = stream_cb
        self.n = len(items)
        
        # Ensure LBS, Fragile, Stop, Weight are present
        assign_thesis_attributes(self.items)

class StandaloneDGWO(ThesisOptimizerBase):
    def run(self):
        start_time = time.time()
        pop = [WolfContinuous(self.n) for _ in range(self.pop_size)]
        
        for w in pop:
            w.decode_and_evaluate(self.items, self.container)
            
        pop.sort(key=lambda w: w.scalar_fitness)
        alpha, beta, delta = pop[0], pop[1], pop[2]
        
        for iteration in range(self.max_iter):
            if time.time() - start_time > self.max_time:
                break
            a = 2.0 - iteration * (2.0 / self.max_iter)
            
            for i in range(self.pop_size):
                _update_position(pop[i], alpha, beta, delta, a)
                pop[i].decode_and_evaluate(self.items, self.container)
                
            pop.sort(key=lambda w: w.scalar_fitness)
            alpha, beta, delta = pop[0], pop[1], pop[2]
            
            if self.stream_cb:
                self._emit(iteration, alpha)
                
        return alpha
        
    def _emit(self, it, best):
        self.stream_cb("iteration_update", {
            "iteration": it + 1,
            "max_iter": self.max_iter,
            "best_bins": best.n_bins,
            "best_su": round(best.su, 2),
            "best_csr": round(best.csr, 2),
            "fitness": round(best.scalar_fitness, 2)
        })

class StandaloneMOGWO(ThesisOptimizerBase):
    def run(self):
        start_time = time.time()
        pop = [WolfContinuous(self.n) for _ in range(self.pop_size)]
        archive = []
        
        for w in pop:
            w.decode_and_evaluate(self.items, self.container)
            self._update_archive(archive, w)
            
        alpha, beta, delta = self._select_leaders(archive)
        
        for iteration in range(self.max_iter):
            if time.time() - start_time > self.max_time:
                break
            a = 2.0 - iteration * (2.0 / self.max_iter)
            
            for i in range(self.pop_size):
                _update_position(pop[i], alpha, beta, delta, a)
                pop[i].decode_and_evaluate(self.items, self.container)
                self._update_archive(archive, pop[i])
                
            # Limit archive size
            if len(archive) > 100:
                archive = self._prune_archive(archive, max_size=100)
                
            alpha, beta, delta = self._select_leaders(archive)
            
            if self.stream_cb:
                self._emit(iteration, alpha)
                
        # Return best from archive based on CSR then SU
        archive.sort(key=lambda w: (w.csr, -w.n_bins, w.su), reverse=True)
        return archive[0]
        
    def _update_archive(self, archive, wolf):
        dominated = []
        is_dominated = False
        for i, a_wolf in enumerate(archive):
            if a_wolf.dominates(wolf):
                is_dominated = True
                break
            elif wolf.dominates(a_wolf):
                dominated.append(i)
                
        if not is_dominated:
            # Remove dominated
            for i in reversed(dominated):
                archive.pop(i)
            # Deep copy to archive
            w_copy = WolfContinuous(self.n, lambda_penalty=self.lambda_penalty)
            w_copy.X = wolf.X.copy()
            w_copy.n_bins = wolf.n_bins
            w_copy.su = wolf.su
            w_copy.csr = wolf.csr
            w_copy.scalar_fitness = wolf.scalar_fitness
            w_copy.placements = dict(wolf.placements)
            archive.append(w_copy)
            
    def _compute_grid_densities(self, archive, n_grids=10):
        if not archive: return []
        su_vals = [w.su for w in archive]
        csr_vals = [w.csr for w in archive]
        su_min, su_max = min(su_vals), max(su_vals)
        csr_min, csr_max = min(csr_vals), max(csr_vals)
        
        # Avoid division by zero
        if su_max == su_min: su_max += 1e-9
        if csr_max == csr_min: csr_max += 1e-9
            
        grid_counts = {}
        wolf_grids = []
        for w in archive:
            g_su = int((w.su - su_min) / (su_max - su_min) * (n_grids - 1))
            g_csr = int((w.csr - csr_min) / (csr_max - csr_min) * (n_grids - 1))
            g = (g_su, g_csr)
            wolf_grids.append(g)
            grid_counts[g] = grid_counts.get(g, 0) + 1
            
        return grid_counts, wolf_grids
        
    def _prune_archive(self, archive, max_size=100):
        """Prunes the archive by removing solutions from the most crowded grids."""
        while len(archive) > max_size:
            grid_counts, wolf_grids = self._compute_grid_densities(archive)
            # Find the most crowded grid
            max_density_grid = max(grid_counts.keys(), key=lambda g: grid_counts[g])
            # Find all wolves in that grid
            candidates = [i for i, g in enumerate(wolf_grids) if g == max_density_grid]
            # Remove a random wolf from the most crowded grid
            remove_idx = random.choice(candidates)
            archive.pop(remove_idx)
        return archive

    def _select_leaders(self, archive):
        if len(archive) < 1:
            # Fallback if empty (shouldn't happen)
            fake = WolfContinuous(self.n, lambda_penalty=self.lambda_penalty)
            return fake, fake, fake
            
        if len(archive) < 3:
            return archive[0], archive[min(1, len(archive)-1)], archive[0]
            
        # Grid-density leader selection (roulette wheel inversely proportional to density)
        grid_counts, wolf_grids = self._compute_grid_densities(archive)
        
        # Constant > 1 to allow selection even for dense grids
        C = 10.0 
        probabilities = []
        for g in wolf_grids:
            p = C / grid_counts[g]
            probabilities.append(p)
            
        total_p = sum(probabilities)
        probabilities = [p / total_p for p in probabilities]
        
        # Select 3 without replacement
        selected_indices = np.random.choice(len(archive), size=3, replace=False, p=probabilities)
        return archive[selected_indices[0]], archive[selected_indices[1]], archive[selected_indices[2]]
            
    def _emit(self, it, best):
        self.stream_cb("iteration_update", {
            "iteration": it + 1,
            "max_iter": self.max_iter,
            "best_bins": best.n_bins,
            "best_su": round(best.su, 2),
            "best_csr": round(best.csr, 2),
            "fitness": None
        })

class SequentialHybrid(StandaloneMOGWO):
    def run(self):
        start_time = time.time()
        # Phase 1: DGWO for T1
        T1 = self.max_iter // 2
        pop = [WolfContinuous(self.n, lambda_penalty=self.lambda_penalty) for _ in range(self.pop_size)]
        
        for w in pop:
            w.decode_and_evaluate(self.items, self.container)
            
        pop.sort(key=lambda w: w.scalar_fitness)
        alpha, beta, delta = pop[0], pop[1], pop[2]
        
        for iteration in range(T1):
            if time.time() - start_time > self.max_time:
                break
            a = 2.0 - iteration * (2.0 / T1)
            for i in range(self.pop_size):
                _update_position(pop[i], alpha, beta, delta, a)
                pop[i].decode_and_evaluate(self.items, self.container)
                
            pop.sort(key=lambda w: w.scalar_fitness)
            alpha, beta, delta = pop[0], pop[1], pop[2]
            
            if self.stream_cb:
                self._emit(iteration, alpha, T1, "Phase 1: DGWO")
                
        # Phase 2: MOGWO for T2 using pop from Phase 1
        T2 = self.max_iter - T1
        archive = []
        for w in pop:
            self._update_archive(archive, w)
            
        alpha, beta, delta = self._select_leaders(archive)
        
        for iteration in range(T2):
            if time.time() - start_time > self.max_time:
                break
            a = 2.0 - iteration * (2.0 / T2)
            for i in range(self.pop_size):
                _update_position(pop[i], alpha, beta, delta, a)
                pop[i].decode_and_evaluate(self.items, self.container)
                self._update_archive(archive, pop[i])
                
            if len(archive) > 100:
                archive = self._prune_archive(archive, max_size=100)
                
            alpha, beta, delta = self._select_leaders(archive)
            
            if self.stream_cb:
                self._emit(T1 + iteration, alpha, T2, "Phase 2: MOGWO")
                
        archive.sort(key=lambda w: (w.csr, -w.n_bins, w.su), reverse=True)
        return archive[0]
        
    def _emit(self, it, best, max_it, phase):
        self.stream_cb("iteration_update", {
            "iteration": it + 1,
            "max_iter": self.max_iter,
            "best_bins": best.n_bins,
            "best_su": round(best.su, 2),
            "best_csr": round(best.csr, 2),
            "phase": phase
        })

class RepairBasedHybrid(StandaloneMOGWO):
    def run(self):
        start_time = time.time()
        pop = [WolfContinuous(self.n) for _ in range(self.pop_size)]
        archive = []
        
        for w in pop:
            # ONLY DIFFERENCE: apply_repair=True
            w.decode_and_evaluate(self.items, self.container, apply_repair=True)
            self._update_archive(archive, w)
            
        alpha, beta, delta = self._select_leaders(archive)
        
        for iteration in range(self.max_iter):
            if time.time() - start_time > self.max_time:
                break
            a = 2.0 - iteration * (2.0 / self.max_iter)
            
            for i in range(self.pop_size):
                _update_position(pop[i], alpha, beta, delta, a)
                # Apply repair R1-R5 before evaluation
                pop[i].decode_and_evaluate(self.items, self.container, apply_repair=True)
                self._update_archive(archive, pop[i])
                
            if len(archive) > 100:
                archive = self._prune_archive(archive, max_size=100)
                
            alpha, beta, delta = self._select_leaders(archive)
            
            if self.stream_cb:
                self._emit(iteration, alpha)
                
        archive.sort(key=lambda w: (w.csr, -w.n_bins, w.su), reverse=True)
        return archive[0]
