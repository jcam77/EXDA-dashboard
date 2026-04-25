"""Literature routes for listing, viewing, and uploading project PDFs."""

from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
import os

from modules import project_manager

literature_bp = Blueprint("literature", __name__)


@literature_bp.route('/list_research_pdfs', methods=['GET'])
def list_research_pdfs():
    """List PDF files available under a project's Literature folder."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err})
    literature_dir = os.path.join(project_root, "Literature")
    if not os.path.exists(literature_dir):
        os.makedirs(literature_dir)
    files_found = []
    for root, dirs, files in os.walk(literature_dir):
        for f in files:
            if f.lower().endswith('.pdf'):
                rel_path = os.path.relpath(os.path.join(root, f), literature_dir)
                files_found.append(rel_path)
    return jsonify({"success": True, "files": files_found})


@literature_bp.route('/view_resource/<path:filename>')
def view_resource(filename):
    """Serve one Literature file from the current project."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400
    literature_dir = os.path.join(project_root, "Literature")
    return send_from_directory(literature_dir, filename)


@literature_bp.route('/upload_research_pdf', methods=['POST'])
def upload_research_pdf():
    """Upload a PDF into the project's Literature folder."""
    file = request.files.get('file')
    project_path = request.form.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400
    if not file or not file.filename:
        return jsonify({"success": False, "error": "No file uploaded"}), 400
    safe_name = secure_filename(file.filename)
    if not safe_name or not safe_name.lower().endswith('.pdf'):
        return jsonify({"success": False, "error": "Only PDF files are allowed"}), 400
    lit_dir = os.path.join(project_root, "Literature")
    if not os.path.exists(lit_dir):
        os.makedirs(lit_dir)
    file.save(os.path.join(lit_dir, safe_name))
    return jsonify({"success": True})
