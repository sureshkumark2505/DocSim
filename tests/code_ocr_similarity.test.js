const { test, describe } = require("node:test");
const assert = require("node:assert");
const codeService = require("../src/services/codeService");

describe("DocSim Code & OCR Cross-Source Similarity Tests (Phase 4 & Phase 13)", () => {
  test("1. Code detection heuristics correctly identify programming constructs", () => {
    const pythonCode = `
      def dijkstra(graph, start):
          distances = {vertex: float('infinity') for vertex in graph}
          distances[start] = 0
          priority_queue = [(0, start)]
          while priority_queue:
              current_distance, current_vertex = heapq.heappop(priority_queue)
              if current_distance > distances[current_vertex]:
                  continue
              for neighbor, weight in graph[current_vertex].items():
                  distance = current_distance + weight
                  if distance < distances[neighbor]:
                      distances[neighbor] = distance
                      heapq.heappush(priority_queue, (distance, neighbor))
          return distances
    `;
    const pyDetect = codeService.detectCode(pythonCode);
    assert.strictEqual(pyDetect.isCode, true, "Python logic correctly detected as code");
    assert.ok(pyDetect.confidence >= 50, "Detection confidence is high");

    const cppCode = `
      #include <iostream>
      #include <vector>
      using namespace std;
      int main() {
          vector<int> arr = {1, 2, 3, 4, 5};
          for (int i = 0; i < arr.size(); i++) {
              cout << arr[i] << " ";
          }
          return 0;
      }
    `;
    const cppDetect = codeService.detectCode(cppCode);
    assert.strictEqual(cppDetect.isCode, true, "C++ logic correctly detected as code");

    const naturalText = `
      In this experiment, we observed the relationship between the angle of inclination
      and the terminal velocity of the rolling cylinder. The results clearly show
      that friction plays a dominant role at lower angles.
    `;
    const essayDetect = codeService.detectCode(naturalText);
    assert.strictEqual(essayDetect.isCode, false, "Natural language essay is not flagged as code");
  });

  test("2. Comment stripping handles single-line and multi-line comments", () => {
    const codeWithComments = `
      // Initialize accumulator
      /* Multi-line author comment:
         Lab Section 4B
      */
      int sum = 0; // inline comment
      for (int i = 0; i < 10; i++) {
          sum += i;
      }
    `;

    const normalized = codeService.normalizeCode(codeWithComments);
    assert.strictEqual(normalized.includes("Initialize accumulator"), false, "Strips single-line comments");
    assert.strictEqual(normalized.includes("Multi-line author comment"), false, "Strips multi-line comments");
    assert.strictEqual(normalized.includes("Lab Section 4B"), false);
    assert.strictEqual(normalized.includes("int sum = 0;"), true, "Preserves code statements");
  });

  test("3. Identifier abstraction detects structural equivalence despite renamed variables", () => {
    const codeA = `
      def calculate_average(scores):
          total_sum = 0
          for score in scores:
              total_sum += score
          return total_sum / len(scores)
    `;

    const codeB = `
      def compute_mean(values):
          acc = 0
          for val in values:
              acc += val
          return acc / len(values)
    `;

    const result = codeService.compareCode(codeA, codeB);
    assert.ok(result.similarity >= 0.70, `Similarity (${result.similarity}) should be high despite variable renames`);

    const tokensA = codeService.tokenizeCode(codeA, true);
    const tokensB = codeService.tokenizeCode(codeB, true);
    
    // Abstract tokens should both contain keywords (def, for, in, return) and 'id'
    assert.ok(tokensA.includes("def"));
    assert.ok(tokensA.includes("for"));
    assert.ok(tokensA.includes("ID"));
    assert.ok(tokensB.includes("ID"));
  });

  test("4. Boilerplate template suppression suppresses header lines", () => {
    const student1 = `
      #include <iostream>
      using namespace std;
      int main() {
          return 0;
      }
    `;

    const student2 = `
      #include <iostream>
      using namespace std;
      int main() {
          return 0;
      }
    `;

    const normalized1 = codeService.normalizeCode(student1, { stripBoilerplate: true });
    assert.strictEqual(normalized1.trim(), "", "Standard boilerplate alone is stripped completely");

    const result = codeService.compareCode(student1, student2);
    assert.strictEqual(result.similarity, 0, "Boilerplate-only documents produce zero code similarity");
  });

  test("5. Cross-source matching: native text matches OCR-extracted code snippet", () => {
    const nativeSourceCode = `
      function binarySearch(arr, target) {
          let left = 0;
          let right = arr.length - 1;
          while (left <= right) {
              const mid = Math.floor((left + right) / 2);
              if (arr[mid] === target) return mid;
              if (arr[mid] < target) left = mid + 1;
              else right = mid - 1;
          }
          return -1;
      }
    `;

    // Simulated OCR output from a screenshot of the same function
    const ocrSnippet = `
      function binarySearch(arr, target) {
          let left = 0;
          let right = arr.length - 1;
          while (left <= right) {
              const mid = Math.floor((left + right) / 2);
              if (arr[mid] === target) return mid;
              if (arr[mid] < target) left = mid + 1;
              else right = mid - 1;
          }
          return -1;
      }
    `;

    const comparison = codeService.compareCode(nativeSourceCode, ocrSnippet);
    assert.strictEqual(comparison.similarity, 1.0, "Native code matches identical OCR code");
    assert.ok(comparison.matchingLines.length >= 3, "Finds matching evidence statements");
  });
});
