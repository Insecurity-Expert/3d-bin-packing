import math
import numpy as np
from geometry_3d import get_dims

def sigmoid(x):
    """Sigmoid transfer function: sigma(x) = 1 / (1 + e^-x)"""
    x = np.clip(x, -500, 500)
    return 1.0 / (1.0 + np.exp(-x))

def decode_position(continuous_vector, items, container, epsilon=1e-9):
    """
    Decodes a continuous d-dimensional vector into a discrete placement arrangement.
    Assumes continuous_vector has length 4 * n:
    [r_1, ..., r_n, x_1, ..., x_n, y_1, ..., y_n, z_1, ..., z_n]
    
    Returns:
        discrete_coords: list of dicts with (item_idx, r, x, y, z)
    """
    n = len(items)
    if len(continuous_vector) != 4 * n:
        raise ValueError(f"Expected continuous vector of length {4*n}, got {len(continuous_vector)}")
    
    r_cont = continuous_vector[0:n]
    x_cont = continuous_vector[n:2*n]
    y_cont = continuous_vector[2*n:3*n]
    z_cont = continuous_vector[3*n:4*n]
    
    L_c, H_c, D_c = container['L'], container['H'], container['D']
    
    discrete_coords = []
    
    for i in range(n):
        sig_r = sigmoid(r_cont[i])
        r_i = int(math.floor(6 * sig_r))
        r_i = max(0, min(5, r_i))
        
        l_i, h_i, d_i = get_dims(items[i], r_i)
        
        sig_x = sigmoid(x_cont[i])
        sig_y = sigmoid(y_cont[i])
        sig_z = sigmoid(z_cont[i])
        
        x_disc = int(math.floor((L_c - l_i + 1 - epsilon) * sig_x))
        y_disc = int(math.floor((H_c - h_i + 1 - epsilon) * sig_y))
        z_disc = int(math.floor((D_c - d_i + 1 - epsilon) * sig_z))
        
        x_disc = max(0, min(L_c - l_i, x_disc))
        y_disc = max(0, min(H_c - h_i, y_disc))
        z_disc = max(0, min(D_c - d_i, z_disc))
        
        discrete_coords.append({
            'item_idx': i,
            'r': r_i,
            'x': x_disc,
            'y': y_disc,
            'z': z_disc,
            'l': l_i,
            'h': h_i,
            'd': d_i
        })
        
    return discrete_coords
