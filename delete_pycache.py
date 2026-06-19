import os
import shutil

def delete_pycaches(start_path='.'):
    deleted_dirs = []

    for root, dirs, files in os.walk(start_path):
        for dir_name in dirs:
            if dir_name in ('__pycache__', 'agent_cards'):
                dir_path = os.path.join(root, dir_name)
                try:
                    shutil.rmtree(dir_path)
                    deleted_dirs.append(dir_path)
                    print(f"Deleted: {dir_path}")
                except Exception as e:
                    print(f"Failed to delete {dir_path}: {e}")

    if not deleted_dirs:
        print("No '__pycache__' or 'agent_cards' folders found.")
    else:
        print(f"\nTotal folders deleted: {len(deleted_dirs)}")

if __name__ == '__main__':
    delete_pycaches('.')