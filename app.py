import os
import json
import uuid
import queue
import threading
import cv2

from flask import Flask, request, jsonify, send_file, Response, render_template

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TMP_DIR = os.path.join(BASE_DIR, 'tmp')
os.makedirs(TMP_DIR, exist_ok=True)

app = Flask(__name__)
jobs = {}  # job_id -> {"queue": Queue}


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    app.run(debug=True, threaded=True)
