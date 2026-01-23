/**
 * TEST ENDPOINT - Remove after debugging PTY issues
 * 
 * Tests PTY command execution by:
 * 1. Checking project context
 * 2. Creating a temp directory
 * 3. Initializing a git repo
 * 4. Running git commands
 */

import { backendManager } from "../core/backend-manager";
import type { OpenCodeBackend } from "../backends/opencode";

interface TestResult {
  step: string;
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
}

interface ProjectInfo {
  directory: string;
  projectId?: string;
  worktree?: string;
  vcs?: string;
  error?: string;
}

export const testPtyRoutes = {
  "/api/test-pty": {
    async POST(req: Request) {
      const results: TestResult[] = [];
      let testDir = "";
      
      try {
        // Get executor - use the backend's configured directory
        const body = await req.json().catch(() => ({})) as { directory?: string };
        
        // Get backend info - cast to OpenCodeBackend to access specific methods
        const backend = backendManager.getBackend() as OpenCodeBackend;
        const backendDir = backend?.getDirectory() || body.directory || "/tmp";
        const client = backend?.getSdkClient();
        
        console.log(`[TestPTY] Backend directory: ${backendDir}`);
        console.log(`[TestPTY] Request directory: ${body.directory || "(not specified)"}`);
        
        // Use the backend's directory since that's where the project context exists
        const directory = backendDir;
        testDir = `${directory}/.ralpher-pty-test-${Date.now()}`;
        
        console.log(`[TestPTY] Starting test with directory: ${directory}`);
        console.log(`[TestPTY] Test working directory: ${testDir}`);
        
        // Check project context first
        let projectInfo: ProjectInfo = { directory };
        if (client) {
          try {
            console.log(`[TestPTY] Checking project.current() for directory: ${directory}`);
            const projectResult = await client.project.current({
              directory,
            });
            if (projectResult.data) {
              const project = projectResult.data as { id: string; worktree: string; vcs?: string };
              projectInfo = {
                directory,
                projectId: project.id,
                worktree: project.worktree,
                vcs: project.vcs,
              };
              console.log(`[TestPTY] Project context: ${JSON.stringify(projectInfo)}`);
            } else {
              projectInfo.error = JSON.stringify(projectResult.error);
              console.log(`[TestPTY] Project check failed: ${projectInfo.error}`);
            }
          } catch (err) {
            projectInfo.error = String(err);
            console.log(`[TestPTY] Project check exception: ${projectInfo.error}`);
          }
        }
        
        results.push({
          step: "Check project context",
          success: !projectInfo.error,
          output: JSON.stringify(projectInfo, null, 2),
          error: projectInfo.error,
          duration: 0,
        });
        
        const executor = await backendManager.getCommandExecutorAsync(directory);

        // Test 1: Create directory
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 1: mkdir ${testDir}`);
          const result = await executor.exec("mkdir", ["-p", testDir]);
          results.push({
            step: `mkdir -p ${testDir}`,
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
          if (!result.success) {
            return Response.json({ results, error: "Failed at mkdir" }, { status: 500 });
          }
        }

        // Test 2: Init git repo
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 2: git init`);
          const result = await executor.exec("git", ["init"], { cwd: testDir });
          results.push({
            step: "git init",
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
          if (!result.success) {
            return Response.json({ results, error: "Failed at git init" }, { status: 500 });
          }
        }

        // Test 3: Configure git user
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 3: git config user.email`);
          const result = await executor.exec("git", ["config", "user.email", "test@ralpher.dev"], { cwd: testDir });
          results.push({
            step: "git config user.email",
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
        }

        // Test 4: Configure git user name
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 4: git config user.name`);
          const result = await executor.exec("git", ["config", "user.name", "Ralpher Test"], { cwd: testDir });
          results.push({
            step: "git config user.name",
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
        }

        // Test 5: Create a file
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 5: create test file`);
          const result = await executor.exec("sh", ["-c", `echo "Hello from Ralpher" > ${testDir}/test.txt`]);
          results.push({
            step: "create test.txt",
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
        }

        // Test 6: Git status
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 6: git status`);
          const result = await executor.exec("git", ["status", "--porcelain"], { cwd: testDir });
          results.push({
            step: "git status --porcelain",
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
        }

        // Test 7: Git add
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 7: git add`);
          const result = await executor.exec("git", ["add", "."], { cwd: testDir });
          results.push({
            step: "git add .",
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
        }

        // Test 8: Git commit
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 8: git commit`);
          const result = await executor.exec("git", ["commit", "-m", "Test commit from Ralpher"], { cwd: testDir });
          results.push({
            step: "git commit",
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
        }

        // Test 9: Git log
        {
          const start = Date.now();
          console.log(`[TestPTY] Step 9: git log`);
          const result = await executor.exec("git", ["log", "--oneline"], { cwd: testDir });
          results.push({
            step: "git log --oneline",
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
        }

        // Cleanup: Remove test directory
        {
          const start = Date.now();
          console.log(`[TestPTY] Cleanup: rm -rf ${testDir}`);
          const result = await executor.exec("rm", ["-rf", testDir]);
          results.push({
            step: `cleanup: rm -rf ${testDir}`,
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            duration: Date.now() - start,
          });
        }

        const allSuccess = results.every((r) => r.success);
        console.log(`[TestPTY] Test completed. All success: ${allSuccess}`);
        
        return Response.json({
          success: allSuccess,
          results,
          testDir,
        });
      } catch (error) {
        console.error(`[TestPTY] Exception: ${String(error)}`);
        return Response.json(
          {
            success: false,
            results,
            error: String(error),
            testDir,
          },
          { status: 500 }
        );
      }
    },
  },
};
