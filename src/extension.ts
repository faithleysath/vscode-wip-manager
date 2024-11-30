import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import ignore from 'ignore';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wip-'));

let hasWIP = false;
let isWipEnabled = false;
let statusBar: vscode.StatusBarItem | undefined;
let change_detected = false;
let fix_duplicate_commit = false;

let current_working_dir = '/sadasdasd';
let git_dir: string | undefined;

let all_branches: string[] = ['main'];
let current_branch = 'main';

const workspaceFolders = vscode.workspace.workspaceFolders;
if (workspaceFolders && workspaceFolders.length > 0) {
    // 取第一个工作区文件夹的路径
    const workspacePath = workspaceFolders[0].uri.fsPath;
    console.log('当前工作区路径:', workspacePath);
    current_working_dir = workspacePath;
    git_dir = path.join(current_working_dir, '.git');
} else {
    console.error('没有打开的工作区');
}

if (git_dir) {
    const heads_dir = path.join(git_dir, 'refs/heads');
    const packed_refs_path = path.join(git_dir, 'packed-refs');
    const branches: Set<string> = new Set(fs.readdirSync(heads_dir));
    const packed_refs = fs.readFileSync(packed_refs_path, 'utf-8').split('\n');
    for (const line of packed_refs) {
        if (line[0] !== '#') {
            const parts = line.split('/');
            const branch = parts[parts.length - 1];
            if (branch) {
                branches.add(branch);
            }
        }
    }
    
    all_branches = [...branches];
    console.log("存在的分支:", all_branches);

    const head_parts = fs.readFileSync(path.join(git_dir, 'HEAD'), 'utf-8').split('\n')[0].split('/');
    const HEAD = head_parts[head_parts.length - 1];

    console.log("当前分支:", HEAD);
    current_branch = HEAD;
}

hasWIP = all_branches.includes("wip");

isWipEnabled = (current_branch === 'wip');

const ig = ignore();

// Load ignore patterns from .gitignore
loadGitIgnore(ig);

// 创建定时任务
const intervalId = setInterval(() => {
    if (isWipEnabled && change_detected && !fix_duplicate_commit) {
        console.log("在wip启用下检测到文件变动！");
        commitpush();
        change_detected = false;
    }
}, 10000);


export function activate(context: vscode.ExtensionContext) {
    if (current_branch === 'wip') {
        exec("git pull", options, (error, stdout, stderr) => {
            if (error) {
                console.error(`执行错误: ${error}`);
                return;
              }
              console.log(`stdout: ${stdout}`);
              console.error(`stderr: ${stderr}`);
        });
    }
    createStatusBar(context);

    // Create a file system watcher
    const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
    console.log("启动文件监视...");

    watcher.onDidCreate((uri) => {
        if (!isExcluded(uri, ig)) {
            // console.log(`File created: ${uri.fsPath}`);
            change_detected = true;
        }
    });

    watcher.onDidChange((uri) => {
        if (!isExcluded(uri, ig)) {
            // console.log(`File changed: ${uri.fsPath}`);
            change_detected = true;
        }
    });

    watcher.onDidDelete((uri) => {
        if (!isExcluded(uri, ig)) {
            // console.log(`File deleted: ${uri.fsPath}`);
            change_detected = true;
        }
    });

    // Add the watcher to the context subscriptions
    context.subscriptions.push(watcher);
}

const options = {
    cwd: current_working_dir
};


function createStatusBar(context: vscode.ExtensionContext) {
    if (!statusBar) {
        statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        updateStatusBar();
        statusBar.command = 'wip.toggleWip';
        context.subscriptions.push(statusBar);

        let disposable = vscode.commands.registerCommand('wip.toggleWip', () => {
            if (isWipEnabled) {
                wip2main();
            } else {
                if (!hasWIP && current_branch === 'main') {
                    console.log("检测到当前无wip分支，创建一个！");
                    fs.writeFileSync(path.join(current_working_dir, "wip"), "Off");
                    exec('git add . && git commit -m "wip: initialize" && git push && git checkout -b wip && git push -u origin wip && git checkout main', options, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`执行错误: ${error}`);
                            return;
                          }
                          console.log(`stdout: ${stdout}`);
                          console.error(`stderr: ${stderr}`);
                          main2wip();
                    });
                    hasWIP = true;
                    console.log("wip分支创建完成！");
                } else {
                    main2wip();
                }
            }
            isWipEnabled = !isWipEnabled;
            updateStatusBar();
        });

        context.subscriptions.push(disposable);

        // show button
        statusBar.show();
    }
}

function updateStatusBar() {
    if (statusBar) {
        if (isWipEnabled) {
            statusBar.text = 'WIP: On';
            statusBar.color = 'green';
        } else {
            statusBar.text = 'WIP: Off';
            statusBar.color = 'red';
        }
    }
}

export function deactivate() {
    clearInterval(intervalId);
    // Cleanup when the extension is deactivated
    if (statusBar) {
        statusBar.dispose();
        statusBar = undefined;
    }
    fs.rmSync(tempDir);
}

function deleteContentsRecursively(dir: string) {
    // Read all the entries in the directory
    const entries = fs.readdirSync(dir);
  
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);

      // Convert the full path to a relative path for ignore matching
      const relativePath = path.relative(dir, fullPath);

      // Skip entries that match the ignore patterns
      if (ig.ignores(relativePath)) {
        continue;
      }
  
      // Check if the entry is a directory or a file
      const stats = fs.lstatSync(fullPath);
  
      if (stats.isDirectory()) {
        // Recursively delete contents of the directory
        deleteContentsRecursively(fullPath);
  
        // Remove the directory itself
        fs.rmdirSync(fullPath);
      } else {
        // Remove the file
        fs.unlinkSync(fullPath);
      }
    }
}

function copyDirectoryContents(src: string, dest: string) {
    // Create the destination directory if it doesn't exist
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
  
    // Read all the entries in the source directory
    const entries = fs.readdirSync(src);
  
    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);

      // Convert the source path to a relative path for ignore matching
      const relativePath = path.relative(src, srcPath);

      // Skip entries that match the ignore patterns
      if (ig.ignores(relativePath)) {
        continue;
      }
  
      // Check if the entry is a directory or a file
      const stats = fs.lstatSync(srcPath);
  
      if (stats.isDirectory()) {
        // Recursively copy the contents of the directory
        copyDirectoryContents(srcPath, destPath);
      } else {
        // Copy the file
        fs.copyFileSync(srcPath, destPath);
      }
    }
}
  
function main2wip() {
    console.log("从main转换到wip中...");
    fix_duplicate_commit = true;
    deleteContentsRecursively(current_working_dir);
    exec("git checkout wip && git restore . && git pull", options, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行错误: ${error}`);
            return;
          }
          console.log(`stdout: ${stdout}`);
          console.error(`stderr: ${stderr}`);
          console.log("main已到wip");
          change_detected = false;
          fix_duplicate_commit = false;
    });
}

function wip2main() {
    console.log("从wip转换到main中...");
    deleteContentsRecursively(tempDir);
    copyDirectoryContents(current_working_dir, tempDir);
    exec("git checkout main", options, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行错误: ${error}`);
            return;
          }
          console.log(`stdout: ${stdout}`);
          console.error(`stderr: ${stderr}`);
          deleteContentsRecursively(current_working_dir);
          copyDirectoryContents(tempDir, current_working_dir);
    });
    console.log("wip已到main");
}

function commitpush() {
    console.log(`正在创建"wip: ${formatDate(new Date())}"...`);
    exec(`git add . && git commit -am "wip: ${formatDate(new Date())}" && git push`, options, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行错误: ${error}`);
            return;
          }
          console.log(`stdout: ${stdout}`);
          console.error(`stderr: ${stderr}`);
    });
}

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function loadGitIgnore(ig: ReturnType<typeof ignore>) {
    // Assuming .gitignore is in the root of the first workspace folder
    const gitignorePath = path.join(current_working_dir, '.gitignore');

    if (fs.existsSync(gitignorePath)) {
        console.log("加载.gitignore文件");
        const content = fs.readFileSync(gitignorePath, 'utf8');
        ig.add(content.split('\n').filter(line => line.trim() !== ''));
    }
    // Always ignore some common directories and files
    ig.add([
        '.git',
        'node_modules',
        'dist',
        'build',
        '.DS_Store',
        'Thumbs.db',
        '*.log',
        '*.tmp',
        '*.swp',
        '*.swo'
    ]);
}

function isExcluded(uri: vscode.Uri, ig: ReturnType<typeof ignore>): boolean {
    const relativePath = vscode.workspace.asRelativePath(uri.fsPath);
    return ig.ignores(relativePath);
}