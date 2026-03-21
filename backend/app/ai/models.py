from enum import Enum


class QueryKind(str, Enum):
    LIGHT = "light"
    DEEP = "deep"
    MEMORY = "memory"


class ModelTier(str, Enum):
    SMALL = "small"
    LARGE = "large"
