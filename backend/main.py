from fastapi import FastAPI
from pydantic import BaseModel
import openai
import os
from supabase import create_client, Client

app = FastAPI()

# Config - use env vars
openai.api_key = os.getenv('OPENAI_API_KEY')
supabase: Client = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

class WorkoutRequest(BaseModel):
    user_id: str
    duration: int
    workout_type: str

@app.post("/generate-workout")
async def generate_workout(request: WorkoutRequest):
    # Get user profile
    profile_response = supabase.table('profiles').select('*').eq('id', request.user_id).execute()
    if not profile_response.data:
        return {"error": "Profile not found"}
    
    p = profile_response.data[0]
    
    prompt = f"""
You are a certified personal trainer. Create a {request.duration}-minute {request.workout_type} workout for a {p['fitness_level']} with access to {', '.join(p['equipment'])}. Their goals: {', '.join(p['goals'])}. Injuries to avoid: {', '.join(p['injuries'])}. Return ONLY valid JSON: {{ "exercises": [{{ "name": "", "sets": 0, "reps": 0, "rest_seconds": 0, "coaching_cue": "", "muscle_group": "" }}] }}
"""
    
    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}]
    )
    
    workout_json = response.choices[0].message.content
    
    # Parse
    import json
    workout_data = json.loads(workout_json)
    
    # Save to workout_plans
    plan = {
        "user_id": request.user_id,
        "plan_data": workout_data
    }
    result = supabase.table('workout_plans').insert(plan).execute()
    
    # Save to workouts
    workout_session = {
        "user_id": request.user_id,
        "title": f"{request.workout_type} Workout",
        "duration": request.duration,
        "plan_type": request.workout_type,
        "plan_id": result.data[0]['id']
    }
    supabase.table('workouts').insert(workout_session).execute()
    
    return {"plan_id": result.data[0]['id'], "workout": workout_data}