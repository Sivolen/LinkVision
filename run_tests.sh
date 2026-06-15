#!/bin/bash
# Script to run LinkVision tests

set -e

echo "=========================================="
echo "LinkVision Test Suite"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Parse arguments
TEST_TYPE=${1:-"all"}
COVERAGE=${2:-"false"}

echo ""
echo "Running test type: $TEST_TYPE"
echo "Coverage: $COVERAGE"
echo ""

# Activate virtual environment if exists
if [ -d "venv" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
fi

# Run tests based on type
case $TEST_TYPE in
    unit)
        echo "Running unit tests only..."
        if [ "$COVERAGE" = "true" ]; then
            pytest tests/test_services.py -v -m "unit" --cov=services --cov-report=term-missing
        else
            pytest tests/test_services.py -v -m "unit"
        fi
        ;;
    integration)
        echo "Running integration tests only..."
        if [ "$COVERAGE" = "true" ]; then
            pytest tests/test_integration.py -v -m "integration" --cov=services --cov-report=term-missing
        else
            pytest tests/test_integration.py -v -m "integration"
        fi
        ;;
    api)
        echo "Running API tests only..."
        if [ "$COVERAGE" = "true" ]; then
            pytest tests/test_api.py -v -m "api" --cov=services --cov-report=term-missing
        else
            pytest tests/test_api.py -v -m "api"
        fi
        ;;
    all)
        echo "Running all tests..."
        if [ "$COVERAGE" = "true" ]; then
            pytest tests/ -v --cov=services --cov-report=term-missing --cov-report=html
        else
            pytest tests/ -v
        fi
        ;;
    *)
        echo "Unknown test type: $TEST_TYPE"
        echo "Usage: $0 [unit|integration|api|all] [true|false]"
        exit 1
        ;;
esac

echo ""
echo "=========================================="
echo "Tests completed!"
echo "=========================================="
