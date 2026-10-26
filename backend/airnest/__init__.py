"""AirNest: AI + IoT ammonia control for poultry houses."""
import os

# Small models on small servers: many OpenMP threads per tiny prediction makes
# scikit-learn dramatically slower (60 s vs 0.25 s measured). One thread is best.
os.environ.setdefault("OMP_NUM_THREADS", "1")
